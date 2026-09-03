export * as TelegramChatSessions from "./chat-sessions"

import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

// Per-Telegram-chat state, persisted to disk so a bot restart doesn't lose
// it and start fresh conversations / forget a chat's chosen repo or model.
export type ChatState = {
  sessionID?: string
  directory: string
  model?: { providerID: string; modelID: string }
}

const file = path.join(Global.Path.data, "telegram-chats.json")

// This file's shape changed once already (a bare sessionID string ->
// {directory, sessionID, model}) — validate on read instead of trusting
// whatever's on disk, so a stale/older-format entry is treated as absent
// (falls back to creating a fresh session) instead of producing a
// ChatState with directory === undefined that then hangs everything
// downstream (InstanceStore.load with no directory to load).
function isChatState(value: unknown): value is ChatState {
  return typeof value === "object" && value !== null && typeof (value as ChatState).directory === "string"
}

export interface Interface {
  readonly get: (chatId: number) => Effect.Effect<ChatState | undefined>
  readonly set: (chatId: number, state: ChatState) => Effect.Effect<void>
  readonly update: (
    chatId: number,
    defaultDirectory: string,
    fn: (state: ChatState) => ChatState,
  ) => Effect.Effect<ChatState>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TelegramChatSessions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const read = () =>
      fs.readJson(file).pipe(
        Effect.map((data) => data as Record<string, unknown>),
        Effect.orElseSucceed(() => ({}) as Record<string, unknown>),
      )

    const get = Effect.fn("TelegramChatSessions.get")(function* (chatId: number) {
      const data = yield* read()
      const value = data[String(chatId)]
      return isChatState(value) ? value : undefined
    })

    const set = Effect.fn("TelegramChatSessions.set")(function* (chatId: number, state: ChatState) {
      const data = yield* read()
      yield* fs.writeJson(file, { ...data, [String(chatId)]: state }).pipe(Effect.orDie)
    })

    const update = Effect.fn("TelegramChatSessions.update")(function* (
      chatId: number,
      defaultDirectory: string,
      fn: (state: ChatState) => ChatState,
    ) {
      const data = yield* read()
      const raw = data[String(chatId)]
      const current = isChatState(raw) ? raw : { directory: defaultDirectory }
      const next = fn(current)
      yield* fs.writeJson(file, { ...data, [String(chatId)]: next }).pipe(Effect.orDie)
      return next
    })

    return Service.of({ get, set, update })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })
