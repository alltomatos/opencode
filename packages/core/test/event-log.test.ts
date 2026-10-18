import { describe, expect } from "bun:test"
import { Effect, Ref, Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { EventLog } from "@opencode-ai/core/event/log"
import { EventBus } from "@opencode-ai/core/event/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { eq } from "drizzle-orm"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const Message = EventV2.define({
  type: "test.log.message",
  durable: {
    version: 1,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    text: Schema.String,
  },
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Database.globalNode, EventBus.node, EventV2.node, LocationServiceMap.node])),
)

describe("EventLog", () => {
  it.live("persists durable events into the location database", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const rows = yield* Effect.gen(function* () {
            const log = yield* EventLog.Service
            const { db } = yield* Database.Service
            yield* log.publish(Message, { id: "agg_log", text: "hello" })
            return yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, "agg_log")).all()
          }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(location)))

          expect(rows).toHaveLength(1)
          expect(rows[0]?.aggregate_id).toBe("agg_log")
          expect(rows[0]?.seq).toBe(0)
        }),
      ),
    ),
  )

  it.live("shares the event bus between root and location services", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const seen = yield* Ref.make<Array<EventV2.Payload>>([])
          const unsubscribe = yield* (yield* EventV2.Service).listen((event) =>
            Ref.update(seen, (events) => [...events, event]),
          )
          yield* Effect.gen(function* () {
            const log = yield* EventLog.Service
            yield* log.publish(Message, { id: "agg_bus", text: "hi" })
          }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(location)))

          const events = yield* Ref.get(seen)
          expect(events.some((event) => event.type === "test.log.message")).toBe(true)
          yield* unsubscribe
        }),
      ),
    ),
  )

  it.live("synchronizes delta from global.db on write and seeds sequence with max(seq)", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const globalService = yield* Database.GlobalService
          // Simula eventos pré-existentes no global.db antes do switch
          const { sql } = yield* Effect.promise(() => import("drizzle-orm"))
          yield* globalService.db.run(
            sql`INSERT INTO event_sequence (aggregate_id, seq, owner_id) VALUES ('agg_delta', 3, NULL)`,
          )
          yield* globalService.db.run(
            sql`INSERT INTO event (id, aggregate_id, seq, type, data)
                VALUES ('ev_d0', 'agg_delta', 3, 'test.log.message', '{"id":"agg_delta","text":"pre"}')`,
          )

          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          yield* Effect.gen(function* () {
            // Usa o facade EventV2 escopado à location
            const events = yield* EventV2.Service
            yield* events.publish(Message, { id: "agg_delta", text: "pos-switch" })
          }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(location)))

          const rows = yield* Effect.gen(function* () {
            const { db } = yield* Database.Service
            return yield* db
              .select()
              .from(EventTable)
              .where(eq(EventTable.aggregate_id, "agg_delta"))
              .orderBy(EventTable.seq)
              .all()
          }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(location)))

          expect(rows.map((r) => r.seq)).toEqual([3, 4])
        }),
      ),
    ),
  )
})
