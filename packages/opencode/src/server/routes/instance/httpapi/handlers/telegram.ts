import { Telegram } from "@/telegram"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { ConnectPayload } from "../groups/telegram"

export const telegramHandlers = HttpApiBuilder.group(InstanceHttpApi, "telegram", (handlers) =>
  Effect.gen(function* () {
    const telegram = yield* Telegram.Service

    const status = Effect.fn("TelegramHttpApi.status")(function* () {
      return yield* telegram.status()
    })

    const connect = Effect.fn("TelegramHttpApi.connect")(function* (ctx: { payload: typeof ConnectPayload.Type }) {
      const instance = yield* InstanceState.context
      return yield* telegram.connect(ctx.payload.token, instance.directory)
    })

    const disconnect = Effect.fn("TelegramHttpApi.disconnect")(function* () {
      yield* telegram.disconnect()
      return true as const
    })

    return handlers.handle("status", status).handle("connect", connect).handle("disconnect", disconnect)
  }),
)
