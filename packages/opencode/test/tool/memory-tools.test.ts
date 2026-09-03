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

  withMemoryDisabled.instance("hides memory_search and memory_save when memory is disabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("memory_search")
      expect(ids).not.toContain("memory_save")
    }),
  )
})
