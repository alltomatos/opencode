import { afterEach, describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

function authFile(entries: Record<string, unknown>) {
  return FSUtil.Service.of({ readJson: () => Effect.succeed(entries) } as unknown as FSUtil.Interface)
}

const addPlugin = (authData: Record<string, unknown>) =>
  Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    const host = yield* PluginHost.make(plugin)
    yield* OmniroutePlugin.effect(host).pipe(Effect.provideService(FSUtil.Service, authFile(authData)))
  })

const connected = (baseURL: string, apiKey: string) => ({
  omnrt: { type: "api", key: apiKey, metadata: { baseURL } },
})

let originalFetch: typeof fetch

describe("OmniroutePlugin enrichment", () => {
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  it.effect("overlays display name and pricing from /api/pricing/models", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/api/pricing/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "claude-sonnet",
                  name: "Claude Sonnet",
                  pricing: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet", owned_by: "anthropic" }] }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      yield* addPlugin(connected("https://gateway.example.com", "sk-test"))

      const model = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("claude-sonnet"))
      expect(model?.name).toBe("Claude Sonnet")
      expect(model?.cost).toEqual([{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }])
    }),
  )

  it.effect("registers models even when the pricing endpoint fails", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/api/pricing/models")) return new Response("fail", { status: 500 })
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet", owned_by: "anthropic" }] }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      yield* addPlugin(connected("https://gateway.example.com", "sk-test"))

      const model = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("claude-sonnet"))
      expect(model).toBeDefined()
      expect(model?.cost).toEqual([])
    }),
  )
})
