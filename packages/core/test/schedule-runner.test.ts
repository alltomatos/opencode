import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Schedule } from "@opencode-ai/core/schedule"
import { ScheduleRunner } from "@opencode-ai/core/schedule/runner"
import { testEffect } from "./lib/effect"

const mockMcpCaller = (handler: ScheduleRunner.McpCallerInterface["callTool"]) =>
  Layer.succeed(
    ScheduleRunner.McpCaller,
    ScheduleRunner.McpCaller.of({
      callTool: handler,
    }),
  )

describe("ScheduleRunner execution and timeout", () => {
  const it = testEffect(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, Schedule.node, ScheduleRunner.mcpCallerNode, ScheduleRunner.skillCallerNode]),
      [[ScheduleRunner.mcpCallerNode, mockMcpCaller((server, tool) => {
        if (server === "disconnected") {
          return Effect.succeed({ success: false, error: `MCP server "${server}" is not connected` })
        }
        if (tool === "missing") {
          return Effect.succeed({ success: false, error: `MCP tool "${tool}" not found on server "${server}"` })
        }
        if (tool === "slow") {
          return Effect.sleep("200 millis").pipe(Effect.as({ success: true }))
        }
        return Effect.succeed({ success: true })
      })]],
    ),
  )

  it.live("executes shell command successfully", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: { kind: "shell", command: 'node -e "console.log(123)"' },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("success")
      expect(executed.lastError).toBeUndefined()
    }),
  )

  it.live("enforces timeout on slow shell command", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: {
          kind: "shell",
          command: 'node -e "setTimeout(() => {}, 5000)"',
          timeoutMs: 100,
        },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("error")
      expect(executed.lastError).toBe("timeout after 100ms")
    }),
  )

  it.live("handles mcp_tool success without agent session", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: {
          kind: "mcp_tool",
          server: "github",
          tool: "list_issues",
          args: { repo: "test" },
        },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("success")
      expect(executed.lastError).toBeUndefined()
    }),
  )

  it.live("records error when MCP server is disconnected", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: {
          kind: "mcp_tool",
          server: "disconnected",
          tool: "some_tool",
        },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("error")
      expect(executed.lastError).toBe('MCP server "disconnected" is not connected')
    }),
  )

  it.live("records error when MCP tool is not found", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: {
          kind: "mcp_tool",
          server: "github",
          tool: "missing",
        },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("error")
      expect(executed.lastError).toBe('MCP tool "missing" not found on server "github"')
    }),
  )

  it.live("enforces timeout on slow mcp_tool", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedule.Service
      const created = yield* schedules.create({
        trigger: { kind: "manual" },
        action: {
          kind: "mcp_tool",
          server: "github",
          tool: "slow",
          timeoutMs: 50,
        },
        enabled: true,
      })

      const executed = yield* ScheduleRunner.runOne(created.id)
      expect(executed.lastStatus).toBe("error")
      expect(executed.lastError).toBe("timeout after 50ms")
    }),
  )
})
