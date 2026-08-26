import { describe, expect, test } from "bun:test"
import { afterEach, mock } from "bun:test"
import { Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Catalog } from "@opencode-ai/core/catalog"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID, resolveAutoSyncMs } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

describe("resolveAutoSyncMs", () => {
  test("defaults to 5 minutes when unconfigured", () => {
    expect(resolveAutoSyncMs(undefined)).toBe(5 * 60_000)
  })
  test("disables when configured as 0", () => {
    expect(resolveAutoSyncMs(0)).toBeUndefined()
  })
  test("clamps below the 60s floor", () => {
    expect(resolveAutoSyncMs(1_000)).toBe(60_000)
  })
  test("keeps a valid configured value", () => {
    expect(resolveAutoSyncMs(120_000)).toBe(120_000)
  })
})

const it = testEffect(PluginTestLayer)
let originalFetch: typeof fetch

describe("OmniroutePlugin background auto-sync", () => {
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  it.effect("reloads the catalog on the configured interval, ignoring the on-demand TTL", () =>
    Effect.gen(function* () {
      let calls = 0
      let modelCount = 1
      originalFetch = globalThis.fetch
      globalThis.fetch = (async () => {
        calls++
        const data = Array.from({ length: modelCount }, (_, i) => ({ id: `model-${i}` }))
        return new Response(JSON.stringify({ data }), { status: 200 })
      }) as unknown as typeof fetch

      const authData = { omnrt: { type: "api", key: "sk-test", metadata: { baseURL: "https://gateway.example.com" } } }
      const fakeFs = FSUtil.Service.of({ readJson: () => Effect.succeed(authData) } as unknown as FSUtil.Interface)

      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* OmniroutePlugin.effect({
            ...host,
            options: { autoSyncIntervalMs: 60_000 },
          } as typeof host).pipe(Effect.provideService(FSUtil.Service, fakeFs))

          expect(calls).toBe(1)

          // The on-demand DISCOVERY_TTL_MS is 5 minutes — well past a single
          // 60s auto-sync tick — proving a second fetch here means the
          // scheduled tick forced it, not TTL expiry.
          modelCount = 2
          yield* TestClock.adjust("61 seconds")
          yield* Effect.yieldNow

          expect(calls).toBe(2)
          const model1 = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("model-1"))
          expect(model1).toBeDefined()
        }),
      )
    }),
  )
})
