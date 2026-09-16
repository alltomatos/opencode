import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Credential.node))

describe("Credential", () => {
  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")
      const renamed = { ...created, label: "Personal" }

      const second = yield* credentials.create({
        integrationID,
        label: "Second account",
        value: Credential.Key.make({ type: "key", key: "second" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([renamed, second])

      yield* credentials.remove(second.id)
      expect(yield* credentials.list(integrationID)).toEqual([renamed])

      yield* credentials.remove(created.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )

  it.effect("keeps multiple credentials per integration side by side", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("kiro")
      const first = yield* credentials.create({
        integrationID,
        label: "team@example.com",
        value: Credential.Key.make({ type: "key", key: "one" }),
      })
      const other = yield* credentials.create({
        integrationID,
        label: "personal@example.com",
        value: Credential.Key.make({ type: "key", key: "two" }),
      })

      const stored = yield* credentials.list(integrationID)
      expect(stored).toHaveLength(2)
      expect(stored.map((credential) => credential.id)).toEqual([first.id, other.id])

      // Removing one connection never touches the other.
      yield* credentials.remove(first.id)
      expect(yield* credentials.list(integrationID)).toEqual([other])
    }),
  )
})
