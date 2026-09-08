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
  // Phase 4 (RAG, #149) — v1 on purpose: this fork's agents carry a
  // handful of small sources (pasted text, a URL), not a document corpus
  // that needs chunking/embeddings/vector search to stay within a context
  // window. So retrieval here is just "fetch/read every configured source
  // and hand the model all of it as context", capped so one huge source
  // can't blow the whole prompt. If agents grow real document collections
  // later, swap this for actual chunked/embedded retrieval without
  // changing the RagSource shape or any caller of this method.
  readonly buildKnowledgeContext: (agent: ConfigAgentUIV1.Agent) => Effect.Effect<string>
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

    const MAX_SOURCE_CHARS = 4000
    const MAX_TOTAL_CHARS = 12000
    const FETCH_TIMEOUT_MS = 8000

    // Turns whatever the URL returns into plain-ish text: strips tags,
    // scripts and styles, collapses whitespace. Not a real HTML parser —
    // good enough for "give the model the gist of this page", not for
    // preserving structure.
    function stripHtml(html: string): string {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }

    const readSource = Effect.fn("AgentUI.readSource")(function* (source: ConfigAgentUIV1.RagSource) {
      if (source.kind === "text") return source.value
      if (source.kind === "url") {
        return yield* Effect.tryPromise(async () => {
          const response = await fetch(source.value, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const contentType = response.headers.get("content-type") ?? ""
          const body = await response.text()
          return contentType.includes("html") ? stripHtml(body) : body
        }).pipe(
          Effect.tapError((cause) => Effect.logWarning("agentui rag source fetch failed", { url: source.value, cause })),
          Effect.orElseSucceed(() => ""),
        )
      }
      // "file" sources land in a later phase (real upload + storage) — see
      // dialog-agentui-v2.tsx's note. Nothing to read yet.
      return ""
    })

    const buildKnowledgeContext = Effect.fn("AgentUI.buildKnowledgeContext")(function* (
      agent: ConfigAgentUIV1.Agent,
    ) {
      if (agent.ragSources.length === 0) return ""
      const chunks = yield* Effect.forEach(agent.ragSources, (source) =>
        readSource(source).pipe(Effect.map((text) => ({ label: source.label, text: text.slice(0, MAX_SOURCE_CHARS) }))),
      )
      let budget = MAX_TOTAL_CHARS
      const parts: string[] = []
      for (const chunk of chunks) {
        if (!chunk.text.trim() || budget <= 0) continue
        const piece = `### ${chunk.label}\n${chunk.text.slice(0, budget)}`
        parts.push(piece)
        budget -= piece.length
      }
      if (parts.length === 0) return ""
      return `Contexto de conhecimento (fontes configuradas para este agente):\n\n${parts.join("\n\n")}`
    })

    return Service.of({ list, get, add, remove, buildKnowledgeContext })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})
