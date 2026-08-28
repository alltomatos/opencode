export * as ExternalAgentTicket from "./ticket"

import { Cache, Context, Duration, Effect, Layer, Schema } from "effect"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { PositiveInt } from "@opencode-ai/core/schema"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Handle } from "."

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

// Mirrors packages/core/src/pty/ticket.ts's PtyTicket.Service — short-lived, single-use
// tokens scoped to a handle + directory/workspace, exchanged for a WebSocket connection.
// Lives in packages/opencode (not core) because ExternalAgent.Service itself does — the
// credential-reading constraint documented in plugin/provider/omniroute.ts applies the same
// way here: core can't depend on opencode's modules.
export const ConnectToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: PositiveInt,
}).annotate({ identifier: "ExternalAgentTicket.ConnectToken" })
export interface ConnectToken extends Schema.Schema.Type<typeof ConnectToken> {}

export type Scope = {
  readonly handle: Handle
  readonly directory?: string
  readonly workspaceID?: WorkspaceV2.ID
}

export interface Interface {
  issue(input: Scope): Effect.Effect<ConnectToken>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExternalAgentTicket") {}

function matches(record: Scope, input: Scope) {
  return record.handle === input.handle && record.directory === input.directory && record.workspaceID === input.workspaceID
}

const noLookup = () => Effect.die("ExternalAgentTicket cache must be used via set/invalidateWhen, never get")

export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("ExternalAgentTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, input)
        return { ticket, expires_in: expiresIn }
      }),
      consume: Effect.fn("ExternalAgentTicket.consume")(function* (input) {
        return yield* Cache.invalidateWhen(cache, input.ticket, (stored) => matches(stored, input))
      }),
    })
  })

const layer = Layer.effect(Service, make())

export const node = LayerNode.make({ service: Service, layer, deps: [] })
