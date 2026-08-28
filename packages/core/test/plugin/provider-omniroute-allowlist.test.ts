import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID, resolveModelAllowlist } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

describe("resolveModelAllowlist", () => {
  test("undefined/empty configured value means no filtering", () => {
    expect(resolveModelAllowlist(undefined)).toBeUndefined()
    expect(resolveModelAllowlist([])).toBeUndefined()
    expect(resolveModelAllowlist("not-an-array")).toBeUndefined()
  })
  test("builds a set from a configured array of ids", () => {
    expect(resolveModelAllowlist(["a", "b"])).toEqual(new Set(["a", "b"]))
  })
  test("drops non-string entries", () => {
    expect(resolveModelAllowlist(["a", 1, null])).toEqual(new Set(["a"]))
  })
})

const it = testEffect(PluginTestLayer)

function authFile(entries: Record<string, unknown>) {
  return FSUtil.Service.of({ readJson: () => Effect.succeed(entries) } as unknown as FSUtil.Interface)
}

const connected = (baseURL: string, apiKey: string) => ({
  omnrt: { type: "api", key: apiKey, metadata: { baseURL } },
})

let originalFetch: typeof fetch

describe("OmniroutePlugin allowlist", () => {
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  it.effect("only registers models present in the configured allowlist", () =>
    Effect.gen(function* () {
      originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string) => {
        if (url.endsWith("/api/pricing/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 })
        return new Response(
          JSON.stringify({
            data: [
              { id: "claude-sonnet", owned_by: "anthropic" },
              { id: "gpt-5", owned_by: "openai" },
              { id: "auto/best-coding", owned_by: "combo" },
            ],
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch

      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const fakeConfig = Config.Service.of({
        entries: () =>
          Effect.succeed([
            {
              type: "document",
              path: "opencode.json",
              info: {
                providers: {
                  omnrt: { api: { settings: { modelAllowlist: ["claude-sonnet", "auto/best-coding"] } } },
                },
              },
            } as any,
          ]),
      })
      yield* OmniroutePlugin.effect(host).pipe(
        Effect.provideService(FSUtil.Service, authFile(connected("https://gateway.example.com", "sk-test"))),
        Effect.provideService(Config.Service, fakeConfig),
      )

      expect(yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("claude-sonnet"))).toBeDefined()
      expect(yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("auto/best-coding"))).toBeDefined()
      expect(yield* catalog.model.get(OmnirouteProviderID, ModelV2.ID.make("gpt-5"))).toBeUndefined()
    }),
  )
})
