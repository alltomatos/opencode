import { afterEach, describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OmniroutePlugin } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

function authFile(entries: Record<string, unknown>) {
  return FSUtil.Service.of({ readJson: () => Effect.succeed(entries) } as unknown as FSUtil.Interface)
}

function fakeConfig(providers: Record<string, unknown>) {
  return Config.Service.of({
    entries: () =>
      Effect.succeed([{ type: "document", path: "opencode.json", info: { providers } } as any]),
  })
}

const it = testEffect(PluginTestLayer)
let originalFetch: typeof fetch

describe("OmniroutePlugin multi-instance", () => {
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  it.effect("registers a second instance declared via provider.omniroute-<suffix>", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/api/pricing/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
        if (url.startsWith("https://prod.example.com")) {
          return new Response(JSON.stringify({ data: [{ id: "prod-model", owned_by: "anthropic" }] }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ data: [{ id: "preprod-model", owned_by: "anthropic" }] }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const authData = {
        omnrt: { type: "api", key: "sk-prod", metadata: { baseURL: "https://prod.example.com" } },
        "omniroute-preprod": { type: "api", key: "sk-preprod", metadata: { baseURL: "https://preprod.example.com" } },
      }
      const configData = fakeConfig({ "omniroute-preprod": {} })

      yield* OmniroutePlugin.effect(host).pipe(
        Effect.provideService(FSUtil.Service, authFile(authData)),
        Effect.provideService(Config.Service, configData),
      )

      const prodModel = yield* catalog.model.get(ProviderV2.ID.make("omnrt"), ModelV2.ID.make("prod-model"))
      expect(prodModel).toBeDefined()
      const preprodModel = yield* catalog.model.get(
        ProviderV2.ID.make("omniroute-preprod"),
        ModelV2.ID.make("preprod-model"),
      )
      expect(preprodModel).toBeDefined()

      const preprodProvider = yield* catalog.provider.get(ProviderV2.ID.make("omniroute-preprod"))
      expect(preprodProvider?.name).toBe("Omniroute (omniroute-preprod)")
      expect(preprodProvider?.api.type === "aisdk" ? preprodProvider.api.url : undefined).toBe(
        "https://preprod.example.com",
      )
    }),
  )

  it.effect("single-instance case (no extra config) behaves as before", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/api/pricing/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
        return new Response(JSON.stringify({ data: [{ id: "solo-model", owned_by: "anthropic" }] }), { status: 200 })
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      yield* OmniroutePlugin.effect(host).pipe(
        Effect.provideService(
          FSUtil.Service,
          authFile({ omnrt: { type: "api", key: "sk-test", metadata: { baseURL: "https://gateway.example.com" } } }),
        ),
        Effect.provideService(Config.Service, fakeConfig({})),
      )

      const model = yield* catalog.model.get(ProviderV2.ID.make("omnrt"), ModelV2.ID.make("solo-model"))
      expect(model).toBeDefined()
      const provider = yield* catalog.provider.get(ProviderV2.ID.make("omnrt"))
      expect(provider?.name).toBe("Omniroute")
    }),
  )
})
