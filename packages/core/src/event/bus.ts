export * as EventBus from "./bus"

import { Cause, Context, Effect, Layer, PubSub, Stream } from "effect"
import type { Definition, Payload } from "@opencode-ai/schema/event"
import { makeGlobalNode, type GlobalNode } from "../effect/app-node"

export type Subscriber<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

export interface Interface {
  /** Fan out an already-committed payload to live subscribers (typed channel, aggregate-agnostic all-stream, and deprecated listeners). */
  readonly emit: (event: Payload, options?: { readonly isolateListeners?: boolean }) => Effect.Effect<void>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  /** @deprecated Use `all()` and consume the returned stream. */
  readonly listen: (listener: Subscriber) => Effect.Effect<Unsubscribe>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EventV2Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const all = yield* PubSub.unbounded<Payload>()
    const typed = new Map<string, PubSub.PubSub<Payload>>()
    const listeners = new Array<Subscriber>()

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* PubSub.shutdown(all)
        yield* Effect.forEach(typed.values(), PubSub.shutdown, { discard: true })
      }),
    )

    const getOrCreate = (definition: Definition) =>
      Effect.gen(function* () {
        const existing = typed.get(definition.type)
        if (existing) return existing
        const created = yield* PubSub.unbounded<Payload>()
        typed.set(definition.type, created)
        return created
      })

    const observe = (event: Payload, observer: Subscriber) =>
      Effect.suspend(() => observer(event)).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) => Effect.logError("Event listener failed", { eventID: event.id, eventType: event.type, cause }),
        ),
      )

    const emit = (event: Payload, options?: { readonly isolateListeners?: boolean }) =>
      Effect.gen(function* () {
        const isolateListeners = options?.isolateListeners ?? false
        yield* Effect.forEach(
          listeners,
          (listener) => (isolateListeners ? observe(event, listener) : listener(event)),
          { discard: true },
        )
        const channel = typed.get(event.type)
        if (channel) yield* PubSub.publish(channel, event)
        yield* PubSub.publish(all, event)
      })

    const subscribe = <D extends Definition>(definition: D): Stream.Stream<Payload<D>> =>
      Stream.unwrap(getOrCreate(definition).pipe(Effect.map((channel) => Stream.fromPubSub(channel)))).pipe(
        Stream.map((event) => event as Payload<D>),
      )

    const listen = (listener: Subscriber): Effect.Effect<Unsubscribe> =>
      Effect.sync(() => {
        listeners.push(listener)
        return Effect.sync(() => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        })
      })

    return Service.of({
      emit,
      subscribe,
      all: () => Stream.fromPubSub(all),
      listen,
    })
  }),
)

export const node: GlobalNode<Service> = makeGlobalNode({ service: Service, layer, deps: [] })
