export * as TelegramChatSessions from "./chat-sessions"

import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

// One opencode session per Telegram chat, persisted to disk so a bot
// restart doesn't lose the mapping and start a brand-new session on the
// next message from an existing conversation.
const file = path.join(Global.Path.data, "telegram-chats.json")

export interface Interface {
  readonly get: (chatId: number) => Effect.Effect<string | undefined>
  readonly set: (chatId: number, sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TelegramChatSessions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const read = () =>
      fs.readJson(file).pipe(
        Effect.map((data) => data as Record<string, string>),
        Effect.orElseSucceed(() => ({}) as Record<string, string>),
      )

    const get = Effect.fn("TelegramChatSessions.get")(function* (chatId: number) {
      const data = yield* read()
      return data[String(chatId)]
    })

    const set = Effect.fn("TelegramChatSessions.set")(function* (chatId: number, sessionID: string) {
      const data = yield* read()
      yield* fs.writeJson(file, { ...data, [String(chatId)]: sessionID }).pipe(Effect.orDie)
    })

    return Service.of({ get, set })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })
