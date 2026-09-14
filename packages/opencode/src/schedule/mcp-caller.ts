export * as ScheduleMcpCaller from "./mcp-caller"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { ScheduleRunner } from "@opencode-ai/core/schedule/runner"
import { MCP } from "@/mcp"

function extractErrorText(content: readonly { type: string; text?: string }[]): string {
  return (
    content
      .flatMap((item) => (item.type === "text" && item.text ? [item.text] : []))
      .filter((text) => text.trim())
      .join("\n\n") || "MCP tool returned an error"
  )
}

/** Wires the Schedule engine's mcp_tool action to this process's real MCP connections. */
export const layer = Layer.effect(
  ScheduleRunner.McpCaller,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    return ScheduleRunner.McpCaller.of({
      callTool: (server, tool, args) =>
        Effect.gen(function* () {
          const statuses: Record<string, { status: string }> = yield* mcp
            .status()
            .pipe(Effect.orElseSucceed(() => ({} as Record<string, { status: string }>)))
          if (statuses[server]?.status !== "connected") {
            return { success: false, error: `MCP server "${server}" is not connected` }
          }
          const catalog = yield* mcp
            .serverCatalog(server)
            .pipe(Effect.orElseSucceed(() => ({ tools: [], prompts: [], resources: [] })))
          if (!catalog.tools.some((t) => t.name === tool)) {
            return { success: false, error: `MCP tool "${tool}" not found on server "${server}"` }
          }
          const raw = yield* mcp.callTool(server, tool, args)
          if (!raw) return { success: false, error: `Failed to execute MCP tool "${tool}" on server "${server}"` }
          if (raw.isError) {
            return { success: false, error: extractErrorText((raw.content ?? []) as { type: string; text?: string }[]) }
          }
          return { success: true }
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: ScheduleRunner.McpCaller, layer, deps: [MCP.node] })
