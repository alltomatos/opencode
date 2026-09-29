export * as ScheduleAgentUICaller from "./agentui-caller"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { ScheduleRunner } from "@opencode-ai/core/schedule/runner"
import { AgentUI } from "@/agentui"

export const layer = Layer.effect(
  ScheduleRunner.AgentUICaller,
  Effect.gen(function* () {
    const agentUI = yield* AgentUI.Service

    return ScheduleRunner.AgentUICaller.of({
      runAgent: (action, workspace) =>
        Effect.gen(function* () {
          const directory = workspace || process.cwd()
          const result = yield* agentUI
            .dispatchChannelMessage({
              id: action.agentId,
              directory,
              chatKey: "schedule",
              message: action.message,
              channel: "sandbox",
            })
            .pipe(
              Effect.map((res) => ({
                success: !res.blocked,
                error: res.blocked ? res.reply : undefined,
                reply: res.reply,
              })),
              Effect.catchTag("AgentUINotFoundError", (err) =>
                Effect.succeed({
                  success: false,
                  error: `Agente não encontrado: ${err.id}`,
                }),
              ),
              Effect.catch((err: unknown) =>
                Effect.succeed({
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                }),
              ),
            )
          return result
        }),
    })
  }),
)

export const node = makeGlobalNode({
  service: ScheduleRunner.AgentUICaller,
  layer,
  deps: [AgentUI.node],
})
