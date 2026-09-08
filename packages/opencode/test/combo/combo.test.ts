import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import { Combo } from "../../src/combo/index"
import { testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"

const it = testEffect(LayerNode.compile(Combo.node))

function combo(overrides: {
  id?: string
  models?: { model: string; priority: number }[]
  failover?: { enabled: boolean; strategy: "priority" | "round-robin" }
  rateLimit?: { requestsPerMinute?: number; tokensPerMinute?: number }
} = {}) {
  return {
    id: overrides.id ?? "combo-1",
    name: "Combo 1",
    models: overrides.models ?? [
      { model: "openrouter/a", priority: 0 },
      { model: "openrouter/b", priority: 1 },
    ],
    failover: overrides.failover ?? { enabled: true, strategy: "priority" as const },
    rateLimit: overrides.rateLimit,
  }
}

it.instance(
  "add()/list()/get()/remove() round-trip",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      expect(yield* svc.list()).toEqual([])

      const created = combo()
      yield* svc.add(created)
      expect(yield* svc.list()).toEqual([created])
      expect(yield* svc.get(created.id)).toEqual(created)

      yield* svc.remove(created.id)
      expect(yield* svc.list()).toEqual([])
    }),
  // Combo.node depends on Provider.node, which does real catalog/network
  // work on first init — same cold-start cost documented in memory.test.ts.
  undefined,
  30000,
)

it.instance("get() fails with ComboNotFoundError for an unknown id", () =>
  Effect.gen(function* () {
    const svc = yield* Combo.Service
    const exit = yield* svc.get("nope").pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance("resolve() fails with ComboExhaustedError once the rate limit is hit", () =>
  Effect.gen(function* () {
    const svc = yield* Combo.Service
    const created = combo({ rateLimit: { requestsPerMinute: 1 } })
    yield* svc.add(created)

    yield* svc.report({ id: created.id, model: "openrouter/a", ok: true })
    const exit = yield* svc.resolve(created.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance(
  "resolve() picks a connected model from the combo",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      const created = combo({ models: [{ model: "test/test-model", priority: 0 }] })
      yield* svc.add(created)

      const resolved = yield* svc.resolve(created.id)
      expect(resolved).toEqual({ providerID: "test", modelID: "test-model" })
    }),
  { config: testProviderConfig("http://127.0.0.1:1") },
)

it.instance(
  "resolve() skips the model reported as failed, on a combo with two connected models",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      const created = combo({
        models: [
          { model: "test/test-model", priority: 0 },
          { model: "test/other-model", priority: 1 },
        ],
      })
      yield* svc.add(created)
      yield* svc.report({ id: created.id, model: "test/test-model", ok: false })

      const resolved = yield* svc.resolve(created.id)
      expect(resolved).toEqual({ providerID: "test", modelID: "other-model" })
    }),
  {
    config: {
      ...testProviderConfig("http://127.0.0.1:1"),
      provider: {
        test: {
          ...testProviderConfig("http://127.0.0.1:1").provider.test,
          models: {
            ...testProviderConfig("http://127.0.0.1:1").provider.test.models,
            "other-model": {
              id: "other-model",
              name: "Other Model",
              attachment: false,
              reasoning: false,
              temperature: false,
              tool_call: true,
              release_date: "2025-01-01",
              limit: { context: 100_000, output: 10_000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
        },
      },
    },
  },
)
