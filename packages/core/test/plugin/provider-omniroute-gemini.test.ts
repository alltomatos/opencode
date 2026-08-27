import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID, geminiSanitizingFetch } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

describe("geminiSanitizingFetch", () => {
  let originalFetch: typeof fetch
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    mock.restore()
  })

  test("strips $schema/$ref/additionalProperties for a gemini model request", async () => {
    let sentBody: string | undefined
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: any, init?: any) => {
      sentBody = init?.body
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const body = JSON.stringify({
      model: "gemini-2.5-pro",
      tools: [
        {
          function: {
            parameters: {
              $schema: "http://json-schema.org/draft-07/schema#",
              additionalProperties: false,
              type: "object",
              properties: { path: { $ref: "#/definitions/x", additionalProperties: true } },
            },
          },
        },
      ],
    })

    await geminiSanitizingFetch("https://gateway.example.com/chat/completions", { method: "POST", body })

    const parsed = JSON.parse(sentBody!)
    const params = parsed.tools[0].function.parameters
    expect(params.$schema).toBeUndefined()
    expect(params.additionalProperties).toBeUndefined()
    expect(params.properties.path.$ref).toBeUndefined()
    expect(params.properties.path.additionalProperties).toBeUndefined()
    expect(params.type).toBe("object")
  })

  test("passes non-gemini requests through unmodified", async () => {
    let sentBody: string | undefined
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: any, init?: any) => {
      sentBody = init?.body
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const body = JSON.stringify({
      model: "claude-sonnet",
      tools: [{ function: { parameters: { $schema: "x", additionalProperties: false } } }],
    })

    await geminiSanitizingFetch("https://gateway.example.com/chat/completions", { method: "POST", body })

    expect(sentBody).toBe(body)
  })

  test("fails open on malformed JSON body", async () => {
    let called = false
    originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      called = true
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    await geminiSanitizingFetch("https://gateway.example.com/chat/completions", {
      method: "POST",
      body: "not json",
    })

    expect(called).toBe(true)
  })
})

const it = testEffect(PluginTestLayer)

describe("OmniroutePlugin registers the gemini-sanitizing fetch", () => {
  it.effect("sets api.settings.fetch once connected", () =>
    Effect.gen(function* () {
      const authData = { omnrt: { type: "api", key: "sk-test", metadata: { baseURL: "https://gateway.example.com" } } }
      const fakeFs = FSUtil.Service.of({ readJson: () => Effect.succeed(authData) } as unknown as FSUtil.Interface)

      const catalog = yield* Catalog.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      yield* OmniroutePlugin.effect(host).pipe(Effect.provideService(FSUtil.Service, fakeFs))

      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.api.type === "aisdk" ? typeof provider.api.settings?.fetch : undefined).toBe("function")
    }),
  )
})
