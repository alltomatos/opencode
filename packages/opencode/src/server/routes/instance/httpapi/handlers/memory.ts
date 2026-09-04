import { Memory } from "@/memory"
import type { ConfigMemoryV1 } from "@opencode-ai/core/v1/config/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { ForgetProjectQuery } from "../groups/memory"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const getConfig = Effect.fn("MemoryHttpApi.getConfig")(function* () {
      return yield* memory.get()
    })

    const setConfig = Effect.fn("MemoryHttpApi.setConfig")(function* (ctx: { payload: ConfigMemoryV1.Info }) {
      return yield* memory.set(ctx.payload)
    })

    const forgetProject = Effect.fn("MemoryHttpApi.forgetProject")(function* (ctx: {
      query: typeof ForgetProjectQuery.Type
    }) {
      yield* memory.forgetProject(ctx.query.directory)
      return true as const
    })

    const projectMemoryStatus = Effect.fn("MemoryHttpApi.projectMemoryStatus")(function* (ctx: {
      query: typeof ForgetProjectQuery.Type
    }) {
      return { hasMemory: yield* memory.hasProjectMemory(ctx.query.directory) }
    })

    return handlers
      .handle("getConfig", getConfig)
      .handle("setConfig", setConfig)
      .handle("forgetProject", forgetProject)
      .handle("projectMemoryStatus", projectMemoryStatus)
  }),
)
