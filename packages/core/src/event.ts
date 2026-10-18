export * as EventV2 from "./event"
export * as Bus from "./event/bus"
export * as Log from "./event/log"

import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Payload } from "@opencode-ai/schema/event"
import { Database } from "./database/database"
import { EventBus } from "./event/bus"
import { EventLog } from "./event/log"
import type { Interface, LayerOptions } from "./event/log"
import { makeGlobalNode } from "./effect/app-node"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
export type { Data, Definition, Payload } from "@opencode-ai/schema/event"
export type { Subscriber, Unsubscribe } from "./event/bus"
export type { Interface, PublishOptions, SerializedEvent, LayerOptions } from "./event/log"
export { InvalidDurableEventError, latestSequence, readAggregate } from "./event/log"

export class SubscriberOverflowError extends Schema.TaggedErrorClass<SubscriberOverflowError>()(
  "EventV2.SubscriberOverflow",
  { capacity: Schema.Int },
) {}

export const define = Event.define
export const versionedType = Event.versionedType

export class Service extends Context.Service<Service, Interface>()("@opencode/Event") {}

export const allBounded = (events: Interface, capacity: number) =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<Payload, SubscriberOverflowError>(capacity)
    const unsubscribe = yield* events.listen((event) =>
      Queue.offer(queue, event).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Queue.fail(queue, new SubscriberOverflowError({ capacity })).pipe(Effect.asVoid),
        ),
      ),
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))
    return Stream.fromQueue(queue)
  })

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    EventLog.make(options).pipe(Effect.map((service) => Service.of(service))),
  )

const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventBus.node] })
