import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { ExternalAgent } from "@/external-agent"
import { testEffect } from "../lib/effect"

const layer = LayerNode.compile(LayerNode.group([ExternalAgent.node]))
const it = testEffect(layer)

describe("ExternalAgent.Service", () => {
  it.effect("spawns a command, captures its output, and goes idle", () =>
    Effect.gen(function* () {
      const externalAgent = yield* ExternalAgent.Service
      const handle = yield* externalAgent.spawn({
        command: "bun",
        args: ["-e", "process.stdout.write('external-worker-ok')"],
        cwd: process.cwd(),
      })

      const output = yield* externalAgent.waitIdle(handle, { idleMs: 1_500, timeoutMs: 15_000 })
      expect(output).toContain("external-worker-ok")

      yield* externalAgent.kill(handle)
    }),
    20_000,
  )

  it.effect("send fails against an unknown handle", () =>
    Effect.gen(function* () {
      const externalAgent = yield* ExternalAgent.Service
      const result = yield* externalAgent.send("nonexistent" as any, "hi").pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
    }),
  )
})
