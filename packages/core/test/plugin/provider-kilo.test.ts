import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { KiloPlugin } from "@opencode-ai/core/plugin/provider/kilo"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  const client = yield* HttpClient.HttpClient
  yield* KiloPlugin.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integration),
    Effect.provideService(HttpClient.HttpClient, http ?? client),
  )
})

const headers = (extra: Record<string, string> = {}) => ({
  "HTTP-Referer": "https://opencode.ai/",
  "X-Title": "opencode",
  "X-KILOCODE-EDITORNAME": "opencode",
  ...extra,
})

describe("KiloPlugin", () => {
  it.effect("is registered so legacy referer headers can be applied", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("kilo"))),
  )

  it.effect("registers a device-auth oauth method", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integration = yield* (yield* Integration.Service).get(Integration.ID.make("kilo"))
      expect(integration?.methods).toEqual([
        { id: Integration.MethodID.make("device"), type: "oauth", label: "Kilo Code account" },
      ])
    }),
  )

  it.effect("applies legacy referer headers only to kilo, with the anonymous fallback key", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("kilo"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.kilo.ai/api/gateway",
          }
          provider.request = { headers: { Existing: "value" }, body: {} }
        })
        catalog.provider.update(ProviderV2.ID.openrouter, () => {})
      })
      yield* addPlugin()
      const kilo = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))
      expect(kilo?.request.headers).toEqual(headers({ Existing: "value" }))
      expect(kilo?.request.body.apiKey).toBe("anonymous")
      expect((yield* catalog.provider.get(ProviderV2.ID.openrouter))?.request.headers).toEqual({})
    }),
  )

  it.effect("uses the connected account's access token instead of the anonymous key", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("kilo"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.kilo.ai/api/gateway",
          }
        })
      })
      yield* integrations.transform((editor) => {
        editor.method.update({
          integrationID: Integration.ID.make("kilo"),
          method: { type: "key", label: "API key" },
        })
      })
      yield* integrations.connection.key({ integrationID: Integration.ID.make("kilo"), key: "user-token" })

      yield* addPlugin()
      const kilo = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))
      expect(kilo?.request.body.apiKey).toBe("user-token")
    }),
  )

  it.effect("uses the exact legacy Kilo header casing and set", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("kilo"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.kilo.ai/api/gateway",
          }
        })
      })
      yield* addPlugin()

      const kilo = yield* catalog.provider.get(ProviderV2.ID.make("kilo"))
      expect(kilo?.request.headers).toEqual(headers())
      expect(kilo?.request.headers).not.toHaveProperty("http-referer")
      expect(kilo?.request.headers).not.toHaveProperty("x-title")
      expect(kilo?.request.headers).not.toHaveProperty("X-Source")
    }),
  )

  it.live("completes the device-auth poll loop and stores the token with no refresh/expiry", () =>
    Effect.gen(function* () {
      let polls = 0
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.method === "POST" && request.url.endsWith("/api/device-auth/codes")) {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({ code: "user-code", verificationUrl: "https://kilo.ai/device?code=user-code", expiresIn: 60 }),
            )
          }
          polls++
          if (polls < 2) return HttpClientResponse.fromWeb(request, new Response(null, { status: 202 }))
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ status: "approved", token: "device-token", userEmail: "person@example.com" }),
          )
        }),
      )
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({
        integrationID: Integration.ID.make("kilo"),
        methodID: Integration.MethodID.make("device"),
        inputs: {},
      })
      expect(attempt.url).toBe("https://kilo.ai/device?code=user-code")
      expect(attempt.instructions).toBe("Enter code: user-code")

      yield* Effect.gen(function* () {
        while ((yield* integrations.attempt.status(attempt.attemptID)).status !== "complete") {
          yield* Effect.promise(() => Bun.sleep(1))
        }
      })

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(Integration.ID.make("kilo")))[0]
      expect(stored?.value).toMatchObject({
        access: "device-token",
        refresh: "",
        expires: 0,
        metadata: { email: "person@example.com" },
      })
    }),
  )

  it.effect("uses the legacy provider-id guard instead of endpoint package matching", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("kilo"), (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.kilo.ai/api/gateway",
          }
        })
        catalog.provider.update(ProviderV2.ID.make("custom-kilo"), (provider) => {
          provider.api = { type: "aisdk", package: "kilo" }
        })
      })
      yield* addPlugin()

      expect((yield* catalog.provider.get(ProviderV2.ID.make("kilo")))?.request.headers).toEqual(headers())
      expect((yield* catalog.provider.get(ProviderV2.ID.make("custom-kilo")))?.request.headers).toEqual({})
    }),
  )
})
