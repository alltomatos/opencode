export * as MaintenanceTool from "./maintenance"

import { ToolFailure } from "@opencode-ai/llm"
import { sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { stat } from "node:fs/promises"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "maintenance"

export const description = `Inspect and run system and database maintenance on OpenCode.
Use 'status' to retrieve current database size, WAL size, event metrics, and whether maintenance is advised.
Use 'run' to optimize SQLite indexes, truncate the WAL log, and purge historical bloated events to recover disk space.`

export const Input = Schema.Struct({
  action: Schema.Literals(["status", "run"]).annotate({
    description: "The maintenance action to execute: 'status' to inspect health/metrics, or 'run' to perform optimization.",
  }),
  purgeOldSessions: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to purge sessions older than maxAgeDays (default: 30 days).",
  }),
  maxAgeDays: Schema.optional(Schema.Number).annotate({
    description: "Age threshold in days for session purging (default: 30).",
  }),
  fullVacuum: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to perform a full SQLite VACUUM to reclaim free space physically from the disk.",
  }),
})

export const Output = Schema.Struct({
  action: Schema.Literals(["status", "run"]),
  dbSizeBytes: Schema.Number,
  walSizeBytes: Schema.Number,
  eventCount: Schema.Number,
  largeEventCount: Schema.Number,
  needsMaintenance: Schema.Boolean,
  freedBytes: Schema.optional(Schema.Number),
  purgedEvents: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  message: Schema.String,
})
export type Output = typeof Output.Type

const formatSize = (bytes: number) => {
  if (!bytes || bytes <= 0) return "0 MB"
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const toModelOutput = (output: Output) => {
  if (output.action === "run") {
    return [
      `System Maintenance executed successfully in ${output.durationMs ?? 0}ms.`,
      `- Space freed: ${formatSize(output.freedBytes ?? 0)}`,
      `- Purged bloated events: ${output.purgedEvents ?? 0}`,
      `- Current DB size: ${formatSize(output.dbSizeBytes)}`,
      `- Current WAL size: ${formatSize(output.walSizeBytes)}`,
      `- Remaining events: ${output.eventCount}`,
    ].join("\n")
  }

  return [
    `System Maintenance Status:`,
    `- Needs maintenance: ${output.needsMaintenance ? "YES (optimization recommended)" : "NO (database healthy)"}`,
    `- DB size: ${formatSize(output.dbSizeBytes)}`,
    `- WAL size: ${formatSize(output.walSizeBytes)}`,
    `- Total events: ${output.eventCount}`,
    `- Large events (>1MB): ${output.largeEventCount}`,
  ].join("\n")
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const { db } = yield* Database.Service
    const permission = yield* PermissionV2.Service

    const getStats = async () => {
      const dbPath = Database.path()
      const walPath = `${dbPath}-wal`

      let dbSizeBytes = 0
      let walSizeBytes = 0

      try {
        const dbStat = await stat(dbPath).catch(() => null)
        if (dbStat) dbSizeBytes = dbStat.size
      } catch {}

      try {
        const walStat = await stat(walPath).catch(() => null)
        if (walStat) walSizeBytes = walStat.size
      } catch {}

      return { dbPath, walPath, dbSizeBytes, walSizeBytes }
    }

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.action],
                save: [input.action],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (input.action === "status") {
                const { dbSizeBytes, walSizeBytes } = yield* Effect.promise(() => getStats())

                let eventCount = 0
                let largeEventCount = 0

                try {
                  const countRes = yield* db.get<{ cnt: number }>(sql`SELECT count(*) as cnt FROM event`).pipe(Effect.orDie)
                  if (countRes) eventCount = Number(countRes.cnt)

                  const largeRes = yield* db
                    .get<{ cnt: number }>(sql`SELECT count(*) as cnt FROM event WHERE length(data) > 1000000`)
                    .pipe(Effect.orDie)
                  if (largeRes) largeEventCount = Number(largeRes.cnt)
                } catch {}

                const needsMaintenance =
                  dbSizeBytes > 1024 * 1024 * 1024 ||
                  walSizeBytes > 50 * 1024 * 1024 ||
                  eventCount > 50000 ||
                  largeEventCount > 50

                return {
                  action: "status" as const,
                  dbSizeBytes,
                  walSizeBytes,
                  eventCount,
                  largeEventCount,
                  needsMaintenance,
                  message: needsMaintenance
                    ? "Database needs maintenance to free disk space and optimize indexes."
                    : "Database is in a healthy state.",
                }
              }

              // action === "run"
              const start = Date.now()
              const before = yield* Effect.promise(() => getStats())
              const beforeTotal = before.dbSizeBytes + before.walSizeBytes

              let beforeEventCount = 0
              try {
                const countRes = yield* db.get<{ cnt: number }>(sql`SELECT count(*) as cnt FROM event`).pipe(Effect.orDie)
                if (countRes) beforeEventCount = Number(countRes.cnt)
              } catch {}

              try {
                // 1. Trunca o WAL
                yield* db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`)

                // 2. Remove eventos inflados antigos
                yield* db.run(
                  sql`DELETE FROM event WHERE length(data) > 1000000 AND type = 'message.updated.1'`,
                )

                // 3. Expurgo de sessões antigas se solicitado
                if (input.purgeOldSessions) {
                  const days = input.maxAgeDays ?? 30
                  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
                  const oldSessions = yield* db
                    .all<{ id: string }>(sql`SELECT id FROM session WHERE time_updated < ${cutoff}`)
                    .pipe(Effect.orDie)

                  for (const s of oldSessions) {
                    yield* db.run(sql`DELETE FROM event WHERE aggregate_id = ${s.id}`).pipe(Effect.ignore)
                    yield* db.run(sql`DELETE FROM event_sequence WHERE aggregate_id = ${s.id}`).pipe(Effect.ignore)
                    yield* db.run(sql`DELETE FROM session WHERE id = ${s.id}`).pipe(Effect.ignore)
                  }
                }

                // 4. Compacta eventos de streaming intermediários (.updated.) em sessões com mais de 7 dias
                const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
                const oldEventSessions = yield* db
                  .all<{ id: string }>(sql`SELECT id FROM session WHERE time_updated < ${sevenDaysAgo}`)
                  .pipe(Effect.orDie)

                for (const s of oldEventSessions) {
                  yield* db
                    .run(sql`DELETE FROM event WHERE aggregate_id = ${s.id} AND type LIKE '%.updated.%'`)
                    .pipe(Effect.ignore)
                }

                // 5. Otimiza SQLite
                yield* db.run(sql`PRAGMA optimize`)

                // 6. Checkpoint final
                yield* db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`)

                // 7. VACUUM se solicitado
                if (input.fullVacuum) {
                  yield* db.run(sql`VACUUM`).pipe(Effect.ignore)
                }
              } catch (err) {
                return yield* new ToolFailure({ message: `Maintenance failed: ${String(err)}` })
              }

              const after = yield* Effect.promise(() => getStats())
              const afterTotal = after.dbSizeBytes + after.walSizeBytes
              const freedBytes = Math.max(0, beforeTotal - afterTotal)

              let eventCount = 0
              let largeEventCount = 0
              try {
                const countRes = yield* db.get<{ cnt: number }>(sql`SELECT count(*) as cnt FROM event`).pipe(Effect.orDie)
                if (countRes) eventCount = Number(countRes.cnt)

                const largeRes = yield* db
                  .get<{ cnt: number }>(sql`SELECT count(*) as cnt FROM event WHERE length(data) > 1000000`)
                  .pipe(Effect.orDie)
                if (largeRes) largeEventCount = Number(largeRes.cnt)
              } catch {}

              const purgedEvents = Math.max(0, beforeEventCount - eventCount)
              const needsMaintenance =
                after.dbSizeBytes > 1024 * 1024 * 1024 ||
                after.walSizeBytes > 50 * 1024 * 1024 ||
                eventCount > 50000 ||
                largeEventCount > 50

              return {
                action: "run" as const,
                dbSizeBytes: after.dbSizeBytes,
                walSizeBytes: after.walSizeBytes,
                eventCount,
                largeEventCount,
                needsMaintenance,
                freedBytes,
                purgedEvents,
                durationMs: Date.now() - start,
                message: `Maintenance completed successfully, freed ${formatSize(freedBytes)}.`,
              }
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: String(err) }))),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/maintenance",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Database.node],
})
