import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { TelegramChatSessions } from "../../src/telegram/chat-sessions"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(TelegramChatSessions.node))

describe("TelegramChatSessions", () => {
  it.instance("returns undefined for a chat that was never mapped", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      const sessionID = yield* chats.get(999)
      expect(sessionID).toBeUndefined()
    }),
  )

  it.instance("persists and retrieves a chat's mapped session", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(123, "ses_abc")
      const sessionID = yield* chats.get(123)
      expect(sessionID).toBe("ses_abc")
    }),
  )

  it.instance("keeps mappings for different chats independent", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(1, "ses_one")
      yield* chats.set(2, "ses_two")
      expect(yield* chats.get(1)).toBe("ses_one")
      expect(yield* chats.get(2)).toBe("ses_two")
    }),
  )

  it.instance("overwrites an existing chat's mapping", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(7, "ses_first")
      yield* chats.set(7, "ses_second")
      expect(yield* chats.get(7)).toBe("ses_second")
    }),
  )
})
