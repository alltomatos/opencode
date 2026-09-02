export * as Telegram from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { Auth } from "../auth"
import { TelegramChatSessions } from "./chat-sessions"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID } from "../session/schema"

const TELEGRAM_AUTH_KEY = "telegram"
const API_ROOT = "https://api.telegram.org"
const POLL_TIMEOUT_SECONDS = 25

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
type TelegramMessage = { chat: { id: number }; text?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage }
type TelegramGetUpdatesResponse = { ok: true; result: TelegramUpdate[] }

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

async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const url = `${API_ROOT}/bot${token}/getUpdates?offset=${offset}&timeout=${POLL_TIMEOUT_SECONDS}`
  const response = await fetch(url)
  const body = (await response.json().catch(() => undefined)) as TelegramGetUpdatesResponse | TelegramApiError | undefined
  if (!response.ok || !body?.ok) {
    const description = body && "description" in body ? body.description : undefined
    throw new Error(description ?? `Telegram API returned ${response.status}`)
  }
  return body.result
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  })
}

async function sendTyping(token: string, chatId: number): Promise<void> {
  await fetch(`${API_ROOT}/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  })
}

export function extractText(result: SessionV1.WithParts): string {
  return result.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export interface Interface {
  readonly connect: (token: string, directory: string) => Effect.Effect<BotInfo, InvalidTokenError>
  readonly disconnect: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Telegram") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const instanceStore = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const chatSessions = yield* TelegramChatSessions.Service

    const connect = Effect.fn("Telegram.connect")(function* (token: string, directory: string) {
      const bot = yield* Effect.tryPromise({
        try: () => fetchBotInfo(token),
        catch: (cause) => new InvalidTokenError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      yield* auth
        .set(TELEGRAM_AUTH_KEY, {
          type: "api",
          key: token,
          metadata: { botId: String(bot.id), username: bot.username, firstName: bot.firstName, directory },
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

    // One opencode session per Telegram chat: reuse the mapped session on
    // every message from a chat we've already seen, create one on the first.
    const handleMessage = Effect.fn("Telegram.handleMessage")(function* (
      token: string,
      directory: string,
      message: TelegramMessage,
    ) {
      const chatId = message.chat.id
      const text = message.text
      if (!text) return
      yield* Effect.tryPromise(() => sendTyping(token, chatId)).pipe(Effect.ignore)

      const ctx = yield* instanceStore.load({ directory })
      const reply = yield* Effect.gen(function* () {
        const cached = yield* chatSessions.get(chatId)
        let sessionID = cached ? SessionID.make(cached) : undefined
        if (!sessionID) {
          const session = yield* sessions.create({ title: `Telegram: ${chatId}` })
          sessionID = session.id
          yield* chatSessions.set(chatId, sessionID)
        }
        const result = yield* promptSvc
          .prompt({ sessionID, parts: [{ type: "text", text }] })
          .pipe(Effect.map((withParts) => extractText(withParts)))
        return result
      }).pipe(
        Effect.provideService(InstanceRef, ctx),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("telegram prompt failed", { chatId, cause })
            return `⚠️ ${cause instanceof Error ? cause.message : String(cause)}`
          }),
        ),
      )
      yield* Effect.tryPromise(() => sendMessage(token, chatId, reply || "(sem resposta)")).pipe(Effect.ignore)
    })

    // Long-poll for the whole server's lifetime, only doing real work while
    // a bot is connected. Sleeps briefly instead of hammering the API when
    // disconnected or between transient errors.
    const pollLoop = Effect.gen(function* () {
      let offset = 0
      while (true) {
        const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
        if (!info || info.type !== "api" || !info.metadata?.directory) {
          yield* Effect.sleep("2 seconds")
          continue
        }
        const token = info.key
        const directory = info.metadata.directory
        const updates = yield* Effect.tryPromise(() => getUpdates(token, offset)).pipe(
          Effect.catch(() => Effect.sleep("3 seconds").pipe(Effect.as<TelegramUpdate[]>([]))),
        )
        for (const update of updates) {
          offset = update.update_id + 1
          if (update.message) yield* handleMessage(token, directory, update.message).pipe(Effect.ignore)
        }
      }
    })
    yield* Effect.forkScoped(pollLoop)

    return Service.of({ connect, disconnect, status })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Auth.node, InstanceStore.node, Session.node, SessionPrompt.node, TelegramChatSessions.node],
})
