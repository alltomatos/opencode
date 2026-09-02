export * as Telegram from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Auth } from "../auth"

const TELEGRAM_AUTH_KEY = "telegram"
const API_ROOT = "https://api.telegram.org"

export const BotInfo = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  firstName: Schema.String,
})
export type BotInfo = Schema.Schema.Type<typeof BotInfo>

export const Status = Schema.Struct({
  connected: Schema.Boolean,
  bot: Schema.optional(BotInfo),
})
export type Status = Schema.Schema.Type<typeof Status>

export class InvalidTokenError extends Schema.TaggedErrorClass<InvalidTokenError>()("TelegramInvalidTokenError", {
  message: Schema.String,
}) {}

// Telegram's own error payload shape for a failed Bot API call — see
// https://core.telegram.org/bots/api#making-requests.
type TelegramApiError = { ok: false; description?: string }
type TelegramGetMeResponse = { ok: true; result: { id: number; username?: string; first_name: string } }

async function fetchBotInfo(token: string): Promise<BotInfo> {
  const response = await fetch(`${API_ROOT}/bot${token}/getMe`)
  const body = (await response.json().catch(() => undefined)) as TelegramGetMeResponse | TelegramApiError | undefined
  if (!response.ok || !body?.ok) {
    const description = body && "description" in body ? body.description : undefined
    throw new Error(description ?? `Telegram API returned ${response.status}`)
  }
  if (!body.result.username) throw new Error("Bot has no username")
  return { id: body.result.id, username: body.result.username, firstName: body.result.first_name }
}

export interface Interface {
  readonly connect: (token: string) => Effect.Effect<BotInfo, InvalidTokenError>
  readonly disconnect: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Telegram") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const connect = Effect.fn("Telegram.connect")(function* (token: string) {
      const bot = yield* Effect.tryPromise({
        try: () => fetchBotInfo(token),
        catch: (cause) => new InvalidTokenError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      yield* auth
        .set(TELEGRAM_AUTH_KEY, {
          type: "api",
          key: token,
          metadata: { botId: String(bot.id), username: bot.username, firstName: bot.firstName },
        })
        .pipe(Effect.orDie)
      return bot
    })

    const disconnect = Effect.fn("Telegram.disconnect")(function* () {
      yield* auth.remove(TELEGRAM_AUTH_KEY).pipe(Effect.orDie)
    })

    const status = Effect.fn("Telegram.status")(function* () {
      const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
      if (!info || info.type !== "api" || !info.metadata?.username) return { connected: false }
      return {
        connected: true,
        bot: {
          id: Number(info.metadata.botId ?? 0),
          username: info.metadata.username,
          firstName: info.metadata.firstName ?? "",
        },
      }
    })

    return Service.of({ connect, disconnect, status })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Auth.node] })
