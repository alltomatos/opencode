export * as AgentUI from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { Config } from "@/config/config"
import { Context, Effect, Layer, Schema } from "effect"

// Phase 1 of the AgentUI epic (#144) — CRUD only. No channel routing, RAG
// retrieval, or guardrail enforcement yet (those are Phases 3-5); this just
// establishes the config shape and lets the Settings UI create/list/edit/
// delete agents. See docs/prd (planning session 2026-09-08) and issue #146.

export class AgentUINotFoundError extends Schema.TaggedErrorClass<AgentUINotFoundError>()("AgentUINotFoundError", {
  id: Schema.String,
}) {
  override get message() {
    return `Agente não encontrado: ${this.id}`
  }
}

export interface Interface {
  readonly list: () => Effect.Effect<ConfigAgentUIV1.Agent[]>
  readonly get: (id: string) => Effect.Effect<ConfigAgentUIV1.Agent, AgentUINotFoundError>
  readonly add: (agent: ConfigAgentUIV1.Agent) => Effect.Effect<ConfigAgentUIV1.Agent>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentUI") {}

const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service

    // Same overlay-on-top-of-disk-config pattern as Batuta.Service and
    // Combo.Service (packages/opencode/src/batuta/index.ts, src/combo/index.ts)
    // — Config.Service.updateGlobal only invalidates its own global cache,
    // not the per-instance merged view Config.Service.get() reads.
    const overlay = new Map<string, ConfigAgentUIV1.Agent | undefined>()

    const list = Effect.fn("AgentUI.list")(function* () {
      const cfg = yield* cfgSvc.get()
      const merged = new Map<string, ConfigAgentUIV1.Agent>(Object.entries(cfg.agentui ?? {}))
      for (const [id, agent] of overlay) {
        if (agent) merged.set(id, agent)
        else merged.delete(id)
      }
      return Array.from(merged.values())
    })

    const get = Effect.fn("AgentUI.get")(function* (id: string) {
      const agents = yield* list()
      const found = agents.find((item) => item.id === id)
      if (!found) return yield* new AgentUINotFoundError({ id })
      return found
    })

    const add = Effect.fn("AgentUI.add")(function* (agent: ConfigAgentUIV1.Agent) {
      overlay.set(agent.id, agent)
      yield* cfgSvc.updateGlobal({ agentui: { [agent.id]: agent } } as unknown as ConfigV1.Info)
      return agent
    })

    const remove = Effect.fn("AgentUI.remove")(function* (id: string) {
      overlay.set(id, undefined)
      yield* cfgSvc.updateGlobal({ agentui: { [id]: undefined } } as unknown as ConfigV1.Info)
    })

    return Service.of({ list, get, add, remove })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})
