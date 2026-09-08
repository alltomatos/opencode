import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import { AgentUI } from "../../src/agentui/index"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(AgentUI.node))

function agent(overrides: { id?: string } = {}) {
  return {
    id: overrides.id ?? "agent-1",
    name: "Agent 1",
    personality: "You are a helpful support agent.",
    model: "openrouter/a",
    channels: [],
    commandTriggers: ["!"],
    ragSources: [],
    guardrails: { enabled: true, level: "basic" as const },
  }
}

// AgentUI.Service's overlay is a module-level Map, and it.instance() only
// gives each test a fresh Config/tmpdir — not a fresh Service instance — so
// state from other tests in this file can leak in. Every test below uses
// its own unique id and cleans up after itself instead of asserting on the
// absolute contents of list().
it.instance("add()/get()/remove() round-trip", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const created = agent({ id: "roundtrip" })

    yield* svc.add(created)
    expect(yield* svc.get(created.id)).toEqual(created)
    expect(yield* svc.list().pipe(Effect.map((list) => list.some((a) => a.id === created.id)))).toBe(true)

    yield* svc.remove(created.id)
    expect(yield* svc.list().pipe(Effect.map((list) => list.some((a) => a.id === created.id)))).toBe(false)
  }),
)

it.instance("get() fails with AgentUINotFoundError for an unknown id", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const exit = yield* svc.get("definitely-not-here").pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance("model accepts both a direct 'provider/model' and a 'combo:<id>' reference", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const direct = agent({ id: "direct-model-test" })
    const viaCombo = { ...agent({ id: "combo-model-test" }), model: "combo:my-combo" }
    yield* svc.add(direct)
    yield* svc.add(viaCombo)

    expect(yield* svc.get(direct.id)).toMatchObject({ model: "openrouter/a" })
    expect(yield* svc.get(viaCombo.id)).toMatchObject({ model: "combo:my-combo" })

    yield* svc.remove(direct.id)
    yield* svc.remove(viaCombo.id)
  }),
)

it.instance("add() replaces an existing agent with the same id", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const id = "replace-test"
    yield* svc.add(agent({ id }))
    yield* svc.add({ ...agent({ id }), name: "Renamed" })

    expect(yield* svc.get(id)).toMatchObject({ name: "Renamed" })
    yield* svc.remove(id)
  }),
)

it.instance("buildKnowledgeContext() returns '' when the agent has no ragSources", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    expect(yield* svc.buildKnowledgeContext(agent())).toBe("")
  }),
)

it.instance("buildKnowledgeContext() inlines 'text' sources under their label", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const withSource = {
      ...agent(),
      ragSources: [{ id: "s1", kind: "text" as const, label: "Política de reembolso", value: "Reembolso em até 7 dias." }],
    }
    const context = yield* svc.buildKnowledgeContext(withSource)
    expect(context).toContain("Política de reembolso")
    expect(context).toContain("Reembolso em até 7 dias.")
  }),
)

it.instance("buildKnowledgeContext() skips 'file' sources (not yet ingestable)", () =>
  Effect.gen(function* () {
    const svc = yield* AgentUI.Service
    const withFile = {
      ...agent(),
      ragSources: [{ id: "s1", kind: "file" as const, label: "Manual", value: "manual.pdf" }],
    }
    expect(yield* svc.buildKnowledgeContext(withFile)).toBe("")
  }),
)
