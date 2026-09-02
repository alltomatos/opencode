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
      const state = yield* chats.get(999)
      expect(state).toBeUndefined()
    }),
  )

  it.instance("persists and retrieves a chat's mapped session", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(123, { directory: "/tmp/repo", sessionID: "ses_abc" })
      const state = yield* chats.get(123)
      expect(state?.sessionID).toBe("ses_abc")
      expect(state?.directory).toBe("/tmp/repo")
    }),
  )

  it.instance("keeps mappings for different chats independent", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(1, { directory: "/tmp/one", sessionID: "ses_one" })
      yield* chats.set(2, { directory: "/tmp/two", sessionID: "ses_two" })
      expect((yield* chats.get(1))?.sessionID).toBe("ses_one")
      expect((yield* chats.get(2))?.sessionID).toBe("ses_two")
    }),
  )

  it.instance("overwrites an existing chat's mapping", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(7, { directory: "/tmp/repo", sessionID: "ses_first" })
      yield* chats.set(7, { directory: "/tmp/repo", sessionID: "ses_second" })
      expect((yield* chats.get(7))?.sessionID).toBe("ses_second")
    }),
  )

  it.instance("update() creates a default state from the given directory when none exists", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      const result = yield* chats.update(42, "/tmp/default", (s) => ({ ...s, sessionID: "ses_new" }))
      expect(result).toEqual({ directory: "/tmp/default", sessionID: "ses_new" })
    }),
  )

  it.instance("update() preserves other fields (e.g. model) while changing one", () =>
    Effect.gen(function* () {
      const chats = yield* TelegramChatSessions.Service
      yield* chats.set(9, {
        directory: "/tmp/repo",
        sessionID: "ses_old",
        model: { providerID: "anthropic", modelID: "claude-opus-5" },
      })
      const result = yield* chats.update(9, "/tmp/repo", (s) => ({ ...s, sessionID: undefined }))
      expect(result.sessionID).toBeUndefined()
      expect(result.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-5" })
    }),
  )
})
