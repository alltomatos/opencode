import { Memory } from "@/memory"
import type { ConfigMemoryV1 } from "@opencode-ai/core/v1/config/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { AddMemoryPayload, ForgetProjectQuery, ProjectEntriesQuery, PromoteMemoryPayload } from "../groups/memory"

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

    const getProjectEntries = Effect.fn("MemoryHttpApi.getProjectEntries")(function* (ctx: {
      query: typeof ProjectEntriesQuery.Type
    }) {
      return yield* memory.loadProject(ctx.query.directory)
    })

    const getGlobalEntries = Effect.fn("MemoryHttpApi.getGlobalEntries")(function* () {
      return yield* memory.loadGlobal()
    })

    const addEntry = Effect.fn("MemoryHttpApi.addEntry")(function* (ctx: {
      payload: typeof AddMemoryPayload.Type
    }) {
      if (ctx.payload.global || !ctx.payload.directory) {
        return yield* memory.promoteGlobal({ summary: ctx.payload.note })
      }
      return yield* memory.remember({ directory: ctx.payload.directory, note: ctx.payload.note })
    })

    const promote = Effect.fn("MemoryHttpApi.promote")(function* (ctx: {
      payload: typeof PromoteMemoryPayload.Type
    }) {
      return yield* memory.promoteGlobal({ summary: ctx.payload.summary })
    })

    return handlers
      .handle("getConfig", getConfig)
      .handle("setConfig", setConfig)
      .handle("forgetProject", forgetProject)
      .handle("projectMemoryStatus", projectMemoryStatus)
      .handle("getProjectEntries", getProjectEntries)
      .handle("getGlobalEntries", getGlobalEntries)
      .handle("addEntry", addEntry)
      .handle("promote", promote)
  }),
)
