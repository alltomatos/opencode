export * as Combo from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigComboV1 } from "@opencode-ai/core/v1/config/combo"
import { Config } from "@/config/config"
import { Provider } from "../provider/provider"
import { Context, Effect, Layer, Schema } from "effect"

// A combo groups several models under one selectable name, with failover
// (try the next one if a model is unreachable/misconfigured) and an
// optional rate limit shared across the whole combo — so a chat, an
// AgentUI, or a Batuta worker can point at "the combo" instead of one
// fixed model. See docs/prd (AgentUI planning session, 2026-09-08) and
// issue #145.

export class ComboNotFoundError extends Schema.TaggedErrorClass<ComboNotFoundError>()("ComboNotFoundError", {
  id: Schema.String,
}) {
  override get message() {
    return `Combo não encontrado: ${this.id}`
  }
}

export class ComboExhaustedError extends Schema.TaggedErrorClass<ComboExhaustedError>()("ComboExhaustedError", {
  id: Schema.String,
}) {
  override get message() {
    return `Combo "${this.id}" não tem nenhum modelo disponível (todos falharam ou o rate limit foi excedido)`
  }
}

export type ResolvedModel = { providerID: string; modelID: string }

export interface Interface {
  readonly list: () => Effect.Effect<ConfigComboV1.Combo[]>
  readonly get: (id: string) => Effect.Effect<ConfigComboV1.Combo, ComboNotFoundError>
  readonly add: (combo: ConfigComboV1.Combo) => Effect.Effect<ConfigComboV1.Combo>
  readonly remove: (id: string) => Effect.Effect<void>
  // Picks the next model to try for this combo, honoring failover strategy
  // and rate limit. Callers report success/failure back via `report` so the
  // next resolve() call can skip a model that just failed (failover) and
  // keep the rate-limit window accurate.
  readonly resolve: (id: string) => Effect.Effect<ResolvedModel, ComboNotFoundError | ComboExhaustedError>
  readonly report: (input: { id: string; model: string; ok: boolean; tokens?: number }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Combo") {}

function parseModel(spec: string): ResolvedModel | undefined {
  const separator = spec.indexOf("/")
  if (separator < 0) return undefined
  return { providerID: spec.slice(0, separator), modelID: spec.slice(separator + 1) }
}

const layer: Layer.Layer<Service, never, Config.Service | Provider.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service
    const provider = yield* Provider.Service

    // Same overlay-on-top-of-disk-config pattern as Batuta.Service.add/remove
    // (packages/opencode/src/batuta/index.ts) — Config.Service.updateGlobal
    // only invalidates its own global cache, not the per-instance merged
    // view Config.Service.get() reads, so a freshly added/removed combo
    // wouldn't be visible via get() alone until some later reload.
    const overlay = new Map<string, ConfigComboV1.Combo | undefined>()

    // Per-combo: which model failed most recently (skip it on the very next
    // resolve, so one bad model doesn't get retried every single call), the
    // round-robin cursor, and the sliding-window rate-limit counters.
    const lastFailed = new Map<string, string>()
    const roundRobinCursor = new Map<string, number>()
    const windows = new Map<string, { requests: number[]; tokens: { at: number; count: number }[] }>()

    const list = Effect.fn("Combo.list")(function* () {
      const cfg = yield* cfgSvc.get()
      const merged = new Map<string, ConfigComboV1.Combo>(Object.entries(cfg.combo ?? {}))
      for (const [id, combo] of overlay) {
        if (combo) merged.set(id, combo)
        else merged.delete(id)
      }
      return Array.from(merged.values())
    })

    const get = Effect.fn("Combo.get")(function* (id: string) {
      const combos = yield* list()
      const found = combos.find((item) => item.id === id)
      if (!found) return yield* new ComboNotFoundError({ id })
      return found
    })

    const add = Effect.fn("Combo.add")(function* (combo: ConfigComboV1.Combo) {
      overlay.set(combo.id, combo)
      yield* cfgSvc.updateGlobal({ combo: { [combo.id]: combo } } as unknown as ConfigV1.Info)
      return combo
    })

    const remove = Effect.fn("Combo.remove")(function* (id: string) {
      overlay.set(id, undefined)
      yield* cfgSvc.updateGlobal({ combo: { [id]: undefined } } as unknown as ConfigV1.Info)
      lastFailed.delete(id)
      roundRobinCursor.delete(id)
      windows.delete(id)
    })

    const window = (id: string) => {
      let w = windows.get(id)
      if (!w) {
        w = { requests: [], tokens: [] }
        windows.set(id, w)
      }
      return w
    }

    // True if the combo's rate limit (if any) still has headroom right now.
    // Sliding 60s window, pruned on every check.
    const withinRateLimit = (combo: ConfigComboV1.Combo) => {
      if (!combo.rateLimit) return true
      const now = Date.now()
      const w = window(combo.id)
      w.requests = w.requests.filter((at) => now - at < 60_000)
      w.tokens = w.tokens.filter((entry) => now - entry.at < 60_000)
      if (combo.rateLimit.requestsPerMinute !== undefined && w.requests.length >= combo.rateLimit.requestsPerMinute)
        return false
      if (combo.rateLimit.tokensPerMinute !== undefined) {
        const total = w.tokens.reduce((sum, entry) => sum + entry.count, 0)
        if (total >= combo.rateLimit.tokensPerMinute) return false
      }
      return true
    }

    const orderedModels = (combo: ConfigComboV1.Combo) => {
      const sorted = [...combo.models].sort((a, b) => a.priority - b.priority)
      if (combo.failover.strategy === "priority") return sorted
      const cursor = roundRobinCursor.get(combo.id) ?? 0
      return [...sorted.slice(cursor % sorted.length), ...sorted.slice(0, cursor % sorted.length)]
    }

    const resolve = Effect.fn("Combo.resolve")(function* (id: string) {
      const combo = yield* get(id)
      if (!withinRateLimit(combo)) return yield* new ComboExhaustedError({ id })

      const skip = combo.failover.enabled ? lastFailed.get(id) : undefined
      for (const entry of orderedModels(combo)) {
        if (entry.model === skip) continue
        const parsed = parseModel(entry.model)
        if (!parsed) continue
        const providerInfo = yield* provider.getProvider(parsed.providerID as any).pipe(Effect.orElseSucceed(() => undefined))
        const modelInfo = providerInfo?.models[parsed.modelID]
        if (!modelInfo) continue
        const language = yield* provider
          .getLanguage(modelInfo)
          .pipe(Effect.catchTag("ProviderModelNotFoundError", () => Effect.succeed(undefined)))
        if (!language) continue
        return parsed
      }
      // Nothing passed the check above (including the one we're skipping) —
      // last resort, try it anyway rather than fail a combo with exactly one
      // model just because it failed once.
      if (skip) {
        const parsed = parseModel(skip)
        if (parsed) return parsed
      }
      return yield* new ComboExhaustedError({ id })
    })

    const report = Effect.fn("Combo.report")(function* (input: { id: string; model: string; ok: boolean; tokens?: number }) {
      if (!input.ok) lastFailed.set(input.id, input.model)
      else if (lastFailed.get(input.id) === input.model) lastFailed.delete(input.id)

      const combo = yield* get(input.id).pipe(Effect.orElseSucceed(() => undefined))
      if (combo?.failover.strategy === "round-robin") {
        const index = combo.models.findIndex((entry) => entry.model === input.model)
        if (index >= 0) roundRobinCursor.set(input.id, index + 1)
      }

      const w = window(input.id)
      const now = Date.now()
      w.requests.push(now)
      if (input.tokens) w.tokens.push({ at: now, count: input.tokens })
    })

    return Service.of({ list, get, add, remove, resolve, report })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node],
})
