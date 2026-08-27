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

describe("OmniroutePlugin discovery", () => {
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  it.effect("does nothing when no credential is connected", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin({})
      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.name).toBe("Omniroute")
      expect(Object.keys((yield* catalog.model.all()).filter((m) => m.providerID === OmnirouteProviderID))).toEqual(
        [],
      )
    }),
  )

  it.effect("populates the catalog from /models once connected", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        expect(url).toBe("https://gateway.example.com/models")
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "claude-sonnet",
                owned_by: "anthropic",
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
                capabilities: { tool_calling: true, vision: true },
              },
              {
                id: "auto/best-coding",
                owned_by: "combo",
                input_modalities: ["text"],
                output_modalities: ["text"],
                capabilities: { tool_calling: false, vision: false },
              },
            ],
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      yield* addPlugin(connected("https://gateway.example.com", "sk-test"))

      const model = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("claude-sonnet"))
      expect(model?.capabilities.tools).toBe(true)
      expect(model?.capabilities.input).toEqual(["text", "image"])
      expect(model?.capabilities.output).toEqual(["text"])

      // Combos register through the exact same path — the gateway is the
      // source of truth for their (already LCD'd) capabilities.
      const combo = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("auto/best-coding"))
      expect(combo?.capabilities.tools).toBe(false)
      expect(combo?.capabilities.input).toEqual(["text"])

      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.api.type === "aisdk" ? provider.api.url : undefined).toBe("https://gateway.example.com")
    }),
  )

  it.effect("keeps the last known-good catalog when discovery fails", () =>
    Effect.gen(function* () {
      let calls = 0
      originalFetch = globalThis.fetch
      globalThis.fetch = (async () => {
        calls++
        return new Response("fail", { status: 500 })
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      yield* addPlugin(connected("https://gateway.example.com", "sk-test"))

      expect(calls).toBeGreaterThan(0)
      const model = yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("claude-sonnet"))
      expect(model).toBeUndefined()
      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.name).toBe("Omniroute")
    }),
  )
})
