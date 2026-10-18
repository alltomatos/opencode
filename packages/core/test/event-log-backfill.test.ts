import { describe, expect, it } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventLogBackfill } from "@opencode-ai/core/database/event-log-backfill"
import { sql } from "drizzle-orm"

describe("EventLogBackfill", () => {
  it("backfills the durable event log into the workspace db verbatim and idempotently", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const source = yield* Database.Service
        yield* source.db.run(
          sql`INSERT INTO session_location (session_id, directory, workspace_id, workspace_hash, time_created, time_updated)
              VALUES ('sess_bf', '/ws/bf', NULL, 'hash_bf', 1, 1)`,
        )
        yield* source.db.run(sql`INSERT INTO event_sequence (aggregate_id, seq, owner_id) VALUES ('sess_bf', 1, NULL)`)
        yield* source.db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data)
              VALUES ('ev_0', 'sess_bf', 0, 'test.a@1', '{"n":0}'),
                     ('ev_1', 'sess_bf', 1, 'test.a@1', '{"n":1}')`,
        )

        const target = yield* Layer.build(Database.layerFromPath(":memory:")).pipe(
          Effect.map((context) => Context.get(context, Database.Service)),
        )

        const first = yield* EventLogBackfill.backfillEventLog(source.db, () => Effect.succeed(target.db))
        expect(first).toMatchObject({ events: 2, sequences: 1, aggregates: 1, workspaces: 1, skippedAggregates: 0 })

        const rows = yield* target.db.all<{ id: string; seq: number }>(
          sql`SELECT id, seq FROM event WHERE aggregate_id = 'sess_bf' ORDER BY seq ASC`,
        )
        expect(rows.map((row) => row.seq)).toEqual([0, 1])
        expect(rows.map((row) => row.id)).toEqual(["ev_0", "ev_1"])

        const sequence = yield* target.db.all<{ seq: number }>(
          sql`SELECT seq FROM event_sequence WHERE aggregate_id = 'sess_bf'`,
        )
        expect(sequence[0]?.seq).toBe(1)

        const second = yield* EventLogBackfill.backfillEventLog(source.db, () => Effect.succeed(target.db))
        expect(second.events).toBe(2)
        const count = yield* target.db.all<{ n: number }>(
          sql`SELECT COUNT(*) AS n FROM event WHERE aggregate_id = 'sess_bf'`,
        )
        expect(count[0]?.n).toBe(2)
      }),
    ).pipe(Effect.provide(Database.layerFromPath(":memory:")))

    await Effect.runPromise(program)
  })
})
