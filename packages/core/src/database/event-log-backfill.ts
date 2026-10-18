export * as EventLogBackfill from "./event-log-backfill"

import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "./database"
import { WorkspaceMigration } from "./workspace-migration"

export interface BackfillSummary {
  readonly events: number
  readonly sequences: number
  readonly aggregates: number
  readonly workspaces: number
  readonly skippedAggregates: number
}

type EventRow = {
  readonly id: string
  readonly aggregate_id: string
  readonly seq: number
  readonly type: string
  readonly data: string
}

type SequenceRow = {
  readonly aggregate_id: string
  readonly seq: number
  readonly owner_id: string | null
}

/**
 * F2a — bulk, idempotent backfill of the durable event log from the legacy
 * `global.db` into each workspace's physical `project.db`.
 *
 * Rows are copied verbatim with their original `seq` — never rebased to 1..N,
 * because clients already hold delta-sync watermarks against those sequences
 * (`durable({ aggregateID, after })`). Each aggregate belongs to exactly one
 * workspace, so per-aggregate contiguity is preserved for free.
 *
 * This step is additive: `global.db` remains authoritative and the write path
 * is untouched (that switch is F2b). Re-running is safe — events use
 * `INSERT OR IGNORE` and the per-aggregate counter is seeded with
 * `MAX(existing, incoming)` so it never moves backwards.
 */
export const backfillEventLog = Effect.fn("EventLogBackfill.run")(function* <R>(
  sourceDb: EffectDrizzleSqlite.EffectSQLiteDatabase,
  targetFor: (workspaceHash: string) => Effect.Effect<EffectDrizzleSqlite.EffectSQLiteDatabase, never, R>,
) {
  const workspaceByAggregate = new Map(
    (yield* sourceDb
      .all<{ aggregate_id: string; workspace_hash: string }>(
        sql`SELECT session_id AS aggregate_id, workspace_hash FROM session_location`,
      )
      .pipe(Effect.orDie)).map((row) => [row.aggregate_id, row.workspace_hash] as const),
  )

  const events = yield* sourceDb
    .all<EventRow>(sql`SELECT id, aggregate_id, seq, type, data FROM event ORDER BY aggregate_id ASC, seq ASC`)
    .pipe(Effect.orDie)
  const sequences = yield* sourceDb
    .all<SequenceRow>(sql`SELECT aggregate_id, seq, owner_id FROM event_sequence`)
    .pipe(Effect.orDie)

  const byWorkspace = new Map<string, { events: EventRow[]; sequences: SequenceRow[] }>()
  const collect = <T extends { aggregate_id: string }>(key: "events" | "sequences", row: T) => {
    const workspaceHash = workspaceByAggregate.get(row.aggregate_id)
    if (!workspaceHash) return false
    const bucket = byWorkspace.get(workspaceHash) ?? { events: [], sequences: [] }
    bucket[key].push(row as never)
    byWorkspace.set(workspaceHash, bucket)
    return true
  }

  const aggregates = new Set<string>()
  let skippedAggregates = 0
  for (const event of events) {
    aggregates.add(event.aggregate_id)
    if (!collect("events", event)) skippedAggregates++
  }
  for (const sequence of sequences) {
    aggregates.add(sequence.aggregate_id)
    if (!collect("sequences", sequence)) skippedAggregates++
  }

  let migratedEvents = 0
  let migratedSequences = 0
  for (const [workspaceHash, bucket] of byWorkspace) {
    const target = yield* targetFor(workspaceHash)
    yield* target
      .transaction(() =>
        Effect.gen(function* () {
          // Sequences first: `event.aggregate_id` references `event_sequence`.
          for (const sequence of bucket.sequences) {
            yield* target.run(
              sql`INSERT INTO event_sequence (aggregate_id, seq, owner_id)
                  VALUES (${sequence.aggregate_id}, ${sequence.seq}, ${sequence.owner_id})
                  ON CONFLICT(aggregate_id) DO UPDATE SET
                    seq = CASE WHEN excluded.seq > event_sequence.seq THEN excluded.seq ELSE event_sequence.seq END,
                    owner_id = COALESCE(event_sequence.owner_id, excluded.owner_id)`,
            )
            migratedSequences++
          }
          for (const event of bucket.events) {
            yield* target.run(
              sql`INSERT OR IGNORE INTO event (id, aggregate_id, seq, type, data)
                  VALUES (${event.id}, ${event.aggregate_id}, ${event.seq}, ${event.type}, ${event.data})`,
            )
            migratedEvents++
          }
        }),
      )
      .pipe(Effect.orDie)
  }

  return {
    events: migratedEvents,
    sequences: migratedSequences,
    aggregates: aggregates.size,
    workspaces: byWorkspace.size,
    skippedAggregates,
  } satisfies BackfillSummary
})

/**
 * Runner one-shot autônomo: abre os project.db físicos através de
 * `WorkspaceMigration.workspaceDatabaseLayer(hash)` e executa o backfill completo.
 */
export const runOneShot = Effect.fn("EventLogBackfill.runOneShot")(function* (
  sourceDb: EffectDrizzleSqlite.EffectSQLiteDatabase,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const targetCache = new Map<string, EffectDrizzleSqlite.EffectSQLiteDatabase>()

      const targetFor = (workspaceHash: string) =>
        Effect.gen(function* () {
          const cached = targetCache.get(workspaceHash)
          if (cached) return cached

          const layer = WorkspaceMigration.workspaceDatabaseLayer(workspaceHash)
          const context = yield* Layer.build(layer)
          const service = Context.get(context, Database.Service)
          targetCache.set(workspaceHash, service.db)
          return service.db
        })

      // Executa o backfill de events/event_sequences
      const summary = yield* backfillEventLog(sourceDb, targetFor)

      // Migra também sessões elegíveis legacy ainda presentes no globalDb usando migrateWorkspaceHistory
      const distinctWorkspaces = yield* sourceDb
        .all<{ directory: string }>(sql`SELECT DISTINCT directory FROM session_location WHERE directory IS NOT NULL`)
        .pipe(Effect.orDie)

      for (const row of distinctWorkspaces) {
        const hash = WorkspaceMigration.directoryToWorkspaceHash(row.directory)
        const target = yield* targetFor(hash)
        yield* WorkspaceMigration.migrateWorkspaceHistory(sourceDb, target, row.directory)
      }

      return summary
    }),
  )
})
