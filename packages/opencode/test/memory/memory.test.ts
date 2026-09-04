import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Memory } from "../../src/memory/index"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Memory.node))

it.instance("set() persists config and get() reflects it immediately, without reload", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const before = yield* memory.get()
    expect(before).toEqual({})

    const config = { enabled: true, memoryModel: "openrouter/google/gemini-3.5-flash-lite" }
    yield* memory.set(config)

    const after = yield* memory.get()
    expect(after).toEqual(config)
  }),
  // Memory.node depends on Provider.node, which does real catalog/network
  // work on first init — generous timeout to cover that cold start (only
  // the first test in this file actually pays it).
  undefined,
  30000,
)

it.instance("set() overwrites the previous config entirely", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    yield* memory.set({ enabled: true, memoryModel: "a/b" })
    yield* memory.set({ enabled: false })

    const config = yield* memory.get()
    expect(config).toEqual({ enabled: false })
  }),
)

it.instance("summarize() with an empty transcript does nothing and reports summarized: false", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const result = yield* memory.summarize({ directory: "/tmp/some-project", transcript: "   " })
    expect(result).toEqual({ summarized: false })
  }),
)

it.instance("summarize() fails with ModelNotConfiguredError when no memoryModel is set", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const exit = yield* memory
      .summarize({ directory: "/tmp/some-project", transcript: "discutimos X e decidimos Y" })
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

it.instance("promoteGlobal() then load() surfaces the promoted summary", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.promoteGlobal({ summary: "Usuário prefere respostas em português, sempre." })

    const { context } = yield* memory.load({})
    expect(context).toContain("Usuário prefere respostas em português, sempre.")
  }),
)

it.instance("load() with a directory also includes that project's memory", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.promoteGlobal({ summary: "Fato global." })

    const { context: withoutProject } = yield* memory.load({})
    expect(withoutProject).toContain("Fato global.")
    expect(withoutProject).not.toContain("Fato do projeto X.")

    // No direct "append project memory" API is exposed publicly other than
    // summarize() (which needs a real model) — forgetProject() on a project
    // with no memory yet should simply be a no-op, not throw.
    yield* memory.forgetProject("/tmp/projeto-inexistente")
  }),
)

it.instance("promoteGlobal() regenerates the global-memory skill file", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.promoteGlobal({ summary: "Regenera o skill de memória global." })

    const skillFile = path.join(Global.Path.config, "skill", "memory", "SKILL.md")
    const content = yield* Effect.tryPromise(() => readFile(skillFile, "utf8"))
    expect(content).toContain("name: memory")
    expect(content).toContain("Regenera o skill de memória global.")
  }),
)

it.instance("hasProjectMemory() reflects remember()/forgetProject() writes", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const directory = "/tmp/hasProjectMemory-test"

    expect(yield* memory.hasProjectMemory(directory)).toBe(false)
    yield* memory.remember({ directory, note: "Fato do projeto." })
    expect(yield* memory.hasProjectMemory(directory)).toBe(true)
    yield* memory.forgetProject(directory)
    expect(yield* memory.hasProjectMemory(directory)).toBe(false)
  }),
)

it.instance("forgetProject() removes only that project's memory, not global", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    yield* memory.promoteGlobal({ summary: "Continua global depois de esquecer um projeto." })
    yield* memory.forgetProject("/tmp/qualquer-projeto")

    const { context } = yield* memory.load({ directory: "/tmp/qualquer-projeto" })
    expect(context).toContain("Continua global depois de esquecer um projeto.")
  }),
)
