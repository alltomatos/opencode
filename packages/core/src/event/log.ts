export * as EventLog from "./log"

import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import { isDeepStrictEqual } from "node:util"
import { Database } from "../database/database"
import { EventBus } from "./bus"
import type { Subscriber } from "./bus"
import { EventSequenceTable, EventTable } from "./sql"
import { Location } from "../location"
import { makeLocationNode, type LocationNode } from "../effect/app-node"

const versionedType = Event.versionedType

export const latestSequence = Effect.fn("EventV2.latestSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
) {
  const row = yield* db
    .select({ seq: EventSequenceTable.seq })
    .from(EventSequenceTable)
    .where(eq(EventSequenceTable.aggregate_id, aggregateID))
    .get()
    .pipe(Effect.orDie)
  return row?.seq ?? -1
})

export type SerializedEvent = {
  readonly id: Event.ID
  readonly type: string
  readonly seq: number
  readonly aggregateID: string
  readonly data: Record<string, unknown>
}

export class InvalidDurableEventError extends Schema.TaggedErrorClass<InvalidDurableEventError>()(
  "EventV2.InvalidDurableEvent",
  {
    type: Schema.String,
    message: Schema.String,
  },
) {}

const decodeSerializedEvent = (event: SerializedEvent): Payload => {
  const definition = Durable.get(event.type)
  if (!definition?.durable) {
    throw new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` })
  }
  return {
    id: event.id,
    type: definition.type,
    durable: { aggregateID: event.aggregateID, seq: event.seq, version: definition.durable.version },
    data: Schema.decodeUnknownSync(definition.data)(event.data),
  }
}

export const readAggregate = Effect.fn("EventV2.readAggregate")(function* <A>(
  db: Database.Interface["db"],
  input: {
    readonly aggregateID: string
    readonly after?: number
    readonly limit: number
    readonly manifest: {
      readonly definitions: ReadonlyMap<string, Definition>
      readonly schema: Schema.Decoder<A, never>
    }
  },
) {
  const after = input.after ?? -1
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, input.aggregateID),
        gt(EventTable.seq, after),
        inArray(EventTable.type, Array.from(input.manifest.definitions.keys())),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie)
  const page = rows.slice(0, input.limit)
  const decode = Schema.decodeUnknownSync(input.manifest.schema)
  const events = page
    .filter((event) => !input.manifest.definitions.get(event.type)?.durable?.transient)
    .map((event) =>
      decode({
        id: event.id,
        type: input.manifest.definitions.get(event.type)?.type ?? event.type,
        durable: {
          aggregateID: event.aggregate_id,
          seq: event.seq,
          version: input.manifest.definitions.get(event.type)?.durable?.version,
        },
        data: event.data,
      }),
    )
  return {
    events,
    hasMore: rows.length > input.limit,
  }
})

export interface PublishOptions {
  readonly id?: Event.ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
  readonly commit?: (seq: number) => Effect.Effect<void>
}

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  readonly durable: (input: { readonly aggregateID: string; readonly after?: number }) => Stream.Stream<Payload>
  /** @deprecated Use `all()` and consume the returned stream. */
  readonly listen: (listener: Subscriber) => Effect.Effect<Effect.Effect<void>>
  readonly project: <D extends Definition>(definition: D, projector: Subscriber<D>) => Effect.Effect<void>
  readonly replay: (
    event: SerializedEvent,
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<void>
  readonly replayAll: (
    events: SerializedEvent[],
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<string | undefined>
  readonly remove: (aggregateID: string) => Effect.Effect<void>
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>
}

export interface LayerOptions {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>
}

/**
 * Binds the durable event log to a specific `Database.Service`. The facade
 * (`EventV2`, global) and the location-scoped `EventLog` share this single
 * implementation; only the resolved database differs.
 */
export const make = (options?: LayerOptions) =>
  Effect.gen(function* () {
    const bus = yield* EventBus.Service
    const pubsub = {
      durable: new Map<string, Set<PubSub.PubSub<void>>>(),
    }
    const projectors = new Map<string, Subscriber[]>()
    // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
    const { db } = yield* Database.Service

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        pubsub.durable.values(),
        (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
        { discard: true },
      ),
    )

    function commitDurableEvent(
      definition: Definition,
      event: Payload,
      input?: {
        readonly seq: number
        readonly aggregateID: string
        readonly ownerID?: string
        readonly strictOwner?: boolean
      },
      commit?: (seq: number) => Effect.Effect<void>,
    ) {
      return Effect.gen(function* () {
        const durable = definition?.durable
        if (durable) {
          const aggregateID = (event.data as Record<string, unknown>)[durable.aggregate]
          if (typeof aggregateID !== "string") {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Expected string aggregate field ${durable.aggregate}`,
              }),
            )
          } else {
            if (input && input.aggregateID !== aggregateID) {
              yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: `Aggregate mismatch: expected ${input.aggregateID}, got ${aggregateID}`,
                }),
              )
            }
            const list = projectors.get(event.type) ?? []
            return yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const committed = yield* db
                  .transaction(
                    () =>
                      Effect.gen(function* () {
                        const row = yield* db
                          .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
                          .from(EventSequenceTable)
                          .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                          .get()
                          .pipe(Effect.orDie)
                        const latest = row?.seq ?? -1
                        const encoded = Schema.encodeUnknownSync(definition.data)(event.data) as Record<
                          string,
                          unknown
                        >
                        if (input?.strictOwner && row?.ownerID && row.ownerID !== input.ownerID) {
                          yield* Effect.die(
                            new InvalidDurableEventError({
                              type: event.type,
                              message: `Replay owner mismatch for aggregate ${aggregateID}: expected ${row.ownerID}, got ${input.ownerID ?? "none"}`,
                            }),
                          )
                        }
                        if (input && input.seq <= latest) {
                          const stored = yield* db
                            .select()
                            .from(EventTable)
                            .where(and(eq(EventTable.aggregate_id, aggregateID), eq(EventTable.seq, input.seq)))
                            .get()
                            .pipe(Effect.orDie)
                          const isTransient = Boolean(durable.transient)
                          const match = isTransient
                            ? stored?.id === event.id &&
                              stored.type === versionedType(definition.type, durable.version)
                            : stored?.id === event.id &&
                              stored.type === versionedType(definition.type, durable.version) &&
                              isDeepStrictEqual(stored.data, encoded)
                          if (match) {
                            if (input.ownerID && row?.ownerID == null) {
                              yield* db
                                .update(EventSequenceTable)
                                .set({ owner_id: input.ownerID })
                                .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                                .run()
                                .pipe(Effect.orDie)
                            }
                            return
                          }
                          yield* Effect.die(
                            new InvalidDurableEventError({
                              type: event.type,
                              message: `Replay diverged at aggregate ${aggregateID} sequence ${input.seq}`,
                            }),
                          )
                        }
                        if (input && row?.ownerID && row.ownerID !== input.ownerID) {
                          return
                        }
                        const seq = input?.seq ?? latest + 1
                        if (input && seq !== latest + 1) {
                          yield* Effect.die(
                            new InvalidDurableEventError({
                              type: event.type,
                              message: `Sequence mismatch for aggregate ${aggregateID}: expected ${latest + 1}, got ${seq}`,
                            }),
                          )
                        }
                        const stored = yield* db
                          .select({ aggregateID: EventTable.aggregate_id, seq: EventTable.seq })
                          .from(EventTable)
                          .where(eq(EventTable.id, event.id))
                          .get()
                          .pipe(Effect.orDie)
                        if (stored)
                          yield* Effect.die(
                            new InvalidDurableEventError({
                              type: event.type,
                              message: `Event ${event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`,
                            }),
                          )
                        const committed = {
                          ...event,
                          durable: { aggregateID, seq, version: durable.version },
                        } as Payload
                        for (const projector of list) {
                          yield* projector(committed)
                        }
                        if (commit) yield* commit(seq)
                        yield* db
                          .insert(EventSequenceTable)
                          .values([{ aggregate_id: aggregateID, seq, owner_id: input?.ownerID }])
                          .onConflictDoUpdate({
                            target: EventSequenceTable.aggregate_id,
                            set: {
                              seq,
                              ...(input?.ownerID && row?.ownerID == null ? { owner_id: input.ownerID } : {}),
                            },
                          })
                          .run()
                          .pipe(Effect.orDie)
                        const isTransient = Boolean(durable.transient)
                        yield* db
                          .insert(EventTable)
                          .values([
                            {
                              id: event.id,
                              aggregate_id: aggregateID,
                              seq,
                              type: versionedType(definition.type, durable.version),
                              data: isTransient ? {} : encoded,
                            },
                          ])
                          .run()
                          .pipe(Effect.orDie)
                        return { aggregateID, seq, isTransient, encoded }
                      }),
                    { behavior: "immediate" },
                  )
                  .pipe(Effect.orDie)
                if (committed) {
                  yield* Effect.forEach(
                    pubsub.durable.get(committed.aggregateID) ?? [],
                    (wake) => PubSub.publish(wake, undefined),
                    { discard: true },
                  )
                }
                return committed
              }),
            )
          }
        }
      })
    }

    function publishEvent<D extends Definition>(definition: D, event: Payload<D>, commit?: PublishOptions["commit"]) {
      return Effect.gen(function* () {
        if (!definition?.durable && commit)
          return yield* Effect.die(
            new InvalidDurableEventError({
              type: event.type,
              message: "Local commit hooks require a durable event",
            }),
          )
        if (definition?.durable) {
          const committed = yield* commitDurableEvent(definition, event as Payload, undefined, commit)
          if (committed) {
            event = {
              ...event,
              durable: {
                aggregateID: committed.aggregateID,
                seq: committed.seq,
                version: definition.durable.version,
              },
            }
            yield* bus.emit(event as Payload, { isolateListeners: true })
            return event
          }
        }
        yield* bus.emit(event as Payload)
        return event
      })
    }

    function publish<D extends Definition>(definition: D, data: Data<D>, options?: PublishOptions) {
      return Effect.gen(function* () {
        const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
        const location =
          options?.location ??
          (serviceLocation
            ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
            : undefined)
        return yield* publishEvent(
          definition,
          {
            id: options?.id ?? Event.ID.create(),
            ...(options?.metadata ? { metadata: options.metadata } : {}),
            type: definition.type,
            ...(location ? { location } : {}),
            data,
          } as Payload<D>,
          options?.commit,
        )
      })
    }

    function replay(
      event: SerializedEvent,
      options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
    ) {
      return Effect.gen(function* () {
        const definition = Durable.get(event.type)
        if (!definition?.durable) {
          yield* Effect.die(
            new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` }),
          )
        } else {
          const payload = {
            id: event.id,
            type: definition.type,
            data: Schema.decodeUnknownSync(definition.data)(event.data),
          } as Payload
          const committed = yield* commitDurableEvent(definition, payload, {
            seq: event.seq,
            aggregateID: event.aggregateID,
            ownerID: options?.ownerID,
            strictOwner: options?.strictOwner,
          })
          if (committed && options?.publish) {
            yield* bus.emit(
              {
                ...payload,
                durable: {
                  aggregateID: committed.aggregateID,
                  seq: committed.seq,
                  version: definition.durable.version,
                },
              },
              { isolateListeners: true },
            )
          }
        }
      })
    }

    function replayAll(
      events: SerializedEvent[],
      options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
    ) {
      return Effect.gen(function* () {
        const source = events[0]?.aggregateID
        if (!source) return undefined
        if (events.some((event) => event.aggregateID !== source)) {
          yield* Effect.die(
            new InvalidDurableEventError({
              type: events[0]?.type ?? "unknown",
              message: "Replay events must belong to the same aggregate",
            }),
          )
        }
        const start = events[0]?.seq ?? 0
        for (const [index, event] of events.entries()) {
          const seq = start + index
          if (event.seq !== seq) {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: `Replay sequence mismatch at index ${index}: expected ${seq}, got ${event.seq}`,
              }),
            )
          }
        }
        for (const event of events) {
          yield* replay(event, options)
        }
        return source
      })
    }

    function remove(aggregateID: string) {
      return db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).run()
            yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run()
          }),
        )
        .pipe(Effect.orDie)
    }

    function claim(aggregateID: string, ownerID: string) {
      return db
        .update(EventSequenceTable)
        .set({ owner_id: ownerID })
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .run()
        .pipe(Effect.orDie)
    }

    const readAfter = (aggregateID: string, after: number) =>
      (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
        Effect.andThen(
          db
            .select()
            .from(EventTable)
            .where(and(eq(EventTable.aggregate_id, aggregateID), gt(EventTable.seq, after)))
            .orderBy(asc(EventTable.seq))
            .all(),
        ),
        Effect.orDie,
        Effect.map((rows) =>
          rows
            .filter((event) => !Durable.get(event.type)?.durable?.transient)
            .map((event) =>
              decodeSerializedEvent({
                id: event.id,
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data,
              }),
            ),
        ),
      )

    const subscribeDurable = (aggregateID: string) =>
      Effect.gen(function* () {
        const wake = yield* PubSub.sliding<void>(1)
        const subscription = yield* PubSub.subscribe(wake)
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const wakes = pubsub.durable.get(aggregateID) ?? new Set()
            wakes.add(wake)
            pubsub.durable.set(aggregateID, wakes)
          }),
          () =>
            Effect.sync(() => {
              const wakes = pubsub.durable.get(aggregateID)
              wakes?.delete(wake)
              if (wakes?.size === 0) pubsub.durable.delete(aggregateID)
            }).pipe(Effect.andThen(PubSub.shutdown(wake))),
        )
        return subscription
      })

    const durable = (input: { readonly aggregateID: string; readonly after?: number }): Stream.Stream<Payload> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const wakes = yield* subscribeDurable(input.aggregateID)
          let sequence = input.after ?? -1
          const read = Effect.suspend(() => readAfter(input.aggregateID, sequence)).pipe(
            Effect.tap((events) =>
              Effect.sync(() => {
                sequence = events.at(-1)?.durable?.seq ?? sequence
              }),
            ),
          )
          const historical = yield* read
          const live = Stream.fromSubscription(wakes).pipe(
            Stream.mapEffect(() => read),
            Stream.flattenIterable,
          )
          return Stream.concat(Stream.fromIterable(historical), live)
        }),
      )

    const project = <D extends Definition>(definition: D, projector: Subscriber<D>): Effect.Effect<void> =>
      Effect.sync(() => {
        const list = projectors.get(definition.type) ?? []
        list.push((event) => projector(event as Payload<D>))
        projectors.set(definition.type, list)
      })

    return {
      publish,
      subscribe: bus.subscribe,
      all: bus.all,
      durable,
      listen: bus.listen,
      project,
      replay,
      replayAll,
      remove,
      claim,
    } satisfies Interface
  })

export class Service extends Context.Service<Service, Interface>()("@opencode/EventV2Log") {}

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    make(options).pipe(Effect.map((service) => Service.of(service))),
  )

const layer = layerWith()
export const node: LocationNode<Service> = makeLocationNode({ service: Service, layer, deps: [Database.node, EventBus.node] })
