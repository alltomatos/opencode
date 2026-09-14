import { AgentUI } from "@/agentui"
import type { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const agentuiHandlers = HttpApiBuilder.group(InstanceHttpApi, "agentui", (handlers) =>
  Effect.gen(function* () {
    const agentui = yield* AgentUI.Service

    const list = Effect.fn("AgentUIHttpApi.list")(function* () {
      return yield* agentui.list()
    })

    const get = Effect.fn("AgentUIHttpApi.get")(function* (ctx: { params: { id: string } }) {
      return yield* agentui.get(ctx.params.id)
    })

    const add = Effect.fn("AgentUIHttpApi.add")(function* (ctx: { payload: ConfigAgentUIV1.Agent }) {
      return yield* agentui.add(ctx.payload)
    })

    const remove = Effect.fn("AgentUIHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      yield* agentui.remove(ctx.params.id)
      return { success: true as const }
    })

    const test = Effect.fn("AgentUIHttpApi.test")(function* (ctx: {
      params: { id: string }
      payload: { projectDirectory: string; message: string }
    }) {
      return yield* agentui.testMessage({
        id: ctx.params.id,
        directory: ctx.payload.projectDirectory,
        message: ctx.payload.message,
      })
    })

    const resetSandbox = Effect.fn("AgentUIHttpApi.resetSandbox")(function* (ctx: { params: { id: string } }) {
      yield* agentui.resetSandbox(ctx.params.id)
      return { success: true as const }
    })

    const generate = Effect.fn("AgentUIHttpApi.generate")(function* (ctx: { payload: { description: string } }) {
      return yield* agentui.generateDraft({ description: ctx.payload.description })
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("add", add)
      .handle("remove", remove)
      .handle("test", test)
      .handle("resetSandbox", resetSandbox)
      .handle("generate", generate)
  }),
)
