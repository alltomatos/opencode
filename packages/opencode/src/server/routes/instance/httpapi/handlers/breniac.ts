import { Breniac } from "@/breniac"
import type { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const breniacHandlers = HttpApiBuilder.group(InstanceHttpApi, "breniac", (handlers) =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service

    const getConfig = Effect.fn("BreniacHttpApi.getConfig")(function* () {
      return yield* breniac.get()
    })

    const setConfig = Effect.fn("BreniacHttpApi.setConfig")(function* (ctx: { payload: ConfigBreniacV1.Info }) {
      return yield* breniac.set(ctx.payload)
    })

    return handlers.handle("getConfig", getConfig).handle("setConfig", setConfig)
  }),
)
