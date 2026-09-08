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

// Combo.Service's overlay is a module-level Map, and it.instance() only
// gives each test a fresh Config/tmpdir — not a fresh Service instance — so
// state from other tests in this file can leak in if they share an id.
// Every test below uses its own unique id and cleans up after itself
// instead of asserting on the absolute contents of list().
it.instance(
  "add()/get()/remove() round-trip",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      const created = combo({ id: "roundtrip" })

      yield* svc.add(created)
      expect(yield* svc.get(created.id)).toEqual(created)
      expect(yield* svc.list().pipe(Effect.map((list) => list.some((c) => c.id === created.id)))).toBe(true)

      yield* svc.remove(created.id)
      expect(yield* svc.list().pipe(Effect.map((list) => list.some((c) => c.id === created.id)))).toBe(false)
    }),
  // Combo.node depends on Provider.node, which does real catalog/network
  // work on first init — same cold-start cost documented in memory.test.ts.
  undefined,
  30000,
)

it.instance("get() fails with ComboNotFoundError for an unknown id", () =>
  Effect.gen(function* () {
    const svc = yield* Combo.Service
    const exit = yield* svc.get("definitely-not-here").pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance("resolve() fails with ComboExhaustedError once the rate limit is hit", () =>
  Effect.gen(function* () {
    const svc = yield* Combo.Service
    const created = combo({ id: "rate-limit-test", rateLimit: { requestsPerMinute: 1 } })
    yield* svc.add(created)

    yield* svc.report({ id: created.id, model: "openrouter/a", ok: true })
    const exit = yield* svc.resolve(created.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    yield* svc.remove(created.id)
  }),
)

it.instance(
  "resolve() picks a connected model from the combo",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      const created = combo({ id: "resolve-single", models: [{ model: "test/test-model", priority: 0 }] })
      yield* svc.add(created)

      const resolved = yield* svc.resolve(created.id)
      expect(resolved).toEqual({ providerID: "test", modelID: "test-model" })
      yield* svc.remove(created.id)
    }),
  { config: testProviderConfig("http://127.0.0.1:1") },
)

it.instance(
  "resolve() skips the model reported as failed, on a combo with two connected models",
  () =>
    Effect.gen(function* () {
      const svc = yield* Combo.Service
      const created = combo({
        id: "resolve-failover",
        models: [
          { model: "test/test-model", priority: 0 },
          { model: "test/other-model", priority: 1 },
        ],
      })
      yield* svc.add(created)
      yield* svc.report({ id: created.id, model: "test/test-model", ok: false })

      const resolved = yield* svc.resolve(created.id)
      expect(resolved).toEqual({ providerID: "test", modelID: "other-model" })
      yield* svc.remove(created.id)
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
