import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { Memory } from "@/memory"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Agent } from "@/agent/agent"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const bootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const root = LayerNode.group([ToolRegistry.node, Agent.node])
const baseReplacements = [
  [Config.node, configLayer],
  [RuntimeFlags.node, RuntimeFlags.layer()],
  [InstanceStore.bootstrapNode, bootstrap],
] as const

const it = testEffect(LayerNode.compile(root, baseReplacements))

const withMemoryDisabled = testEffect(
  LayerNode.compile(root, [
    ...baseReplacements,
    [
      Memory.node,
      Layer.mock(Memory.Service, {
        get: () => Effect.succeed({ enabled: false }),
      }),
    ],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry memory tools", () => {
  it.instance("exposes memory_search and memory_save by default (memory is on unless explicitly disabled)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("memory_search")
      expect(ids).toContain("memory_save")
    }),
  )

  it.instance("memory_save accepts project and global scopes, and memory_search searches with scope and query", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const saveTool = tools.find((t) => t.id === "memory_save")
      const searchTool = tools.find((t) => t.id === "memory_search")

      expect(saveTool).toBeDefined()
      expect(searchTool).toBeDefined()

      // Save project note
      const saveProjectRes = yield* saveTool!.execute({ note: "Regra do projeto X", scope: "project" }, {} as any)
      expect(saveProjectRes.title).toContain("projeto")

      // Save global note
      const saveGlobalRes = yield* saveTool!.execute({ note: "Preferência global do usuário Y", scope: "global" }, {} as any)
      expect(saveGlobalRes.title).toContain("global")

      // Search project scope
      const searchProjRes = yield* searchTool!.execute({ scope: "project" }, {} as any)
      expect(searchProjRes.output).toContain("Regra do projeto X")
      expect(searchProjRes.output).not.toContain("Preferência global do usuário Y")

      // Search global scope
      const searchGlobRes = yield* searchTool!.execute({ scope: "global" }, {} as any)
      expect(searchGlobRes.output).toContain("Preferência global do usuário Y")
      expect(searchGlobRes.output).not.toContain("Regra do projeto X")

      // Search all with query
      const searchAllRes = yield* searchTool!.execute({ scope: "all", query: "Regra" }, {} as any)
      expect(searchAllRes.output).toContain("Regra do projeto X")
    }),
  )

  withMemoryDisabled.instance("hides memory_search and memory_save when memory is disabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("memory_search")
      expect(ids).not.toContain("memory_save")
    }),
  )
})
