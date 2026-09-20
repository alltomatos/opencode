import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GoogleAntigravityPlugin } from "@opencode-ai/core/plugin/provider/google-antigravity"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const ideID = Integration.ID.make("google-antigravity")
const cliID = Integration.ID.make("google-antigravity-cli")
const methodID = Integration.MethodID.make("oauth")

const addPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  const client = yield* HttpClient.HttpClient
  yield* GoogleAntigravityPlugin.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integration),
    Effect.provideService(HttpClient.HttpClient, http ?? client),
  )
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

function mockHttp(handlers: Record<string, () => unknown>) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      const handler = handlers[request.url]
      if (!handler) throw new Error(`Unexpected request: ${request.url}`)
      return HttpClientResponse.fromWeb(request, Response.json(handler()))
    }),
  )
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 2000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("GoogleAntigravityPlugin", () => {
  it.effect("registers the CLI integration with baked-in official client id", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(cliID))?.methods).toEqual([{ id: methodID, type: "oauth", label: "Google account" }])
    }),
  )

  it.effect("registers a connectable catalog card for the provider", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const catalog = yield* Catalog.Service
      expect((yield* catalog.provider.get(ProviderV2.ID.make("google-antigravity-cli")))?.name).toBe(
        "AGY CLI",
      )
    }),
  )

  it.effect("uses AGY env var pair to override client id/secret", () =>
    withEnv(
      {
        AGY_OAUTH_CLIENT_ID: "cli-client",
        AGY_OAUTH_CLIENT_SECRET: "cli-secret",
      },
      () =>
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const cliAttempt = yield* integrations.connection.oauth({ integrationID: cliID, methodID, inputs: {} })
          expect(cliAttempt.url).toContain("client_id=cli-client")
          yield* integrations.attempt.cancel(cliAttempt.attemptID)
        }),
    ),
  )

  it.live("completes the loopback authorization round trip and stores the credential", () =>
    Effect.gen(function* () {
      const http = mockHttp({
        "https://oauth2.googleapis.com/token": () => ({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
        "https://www.googleapis.com/oauth2/v1/userinfo": () => ({ email: "person@example.com" }),
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist": () => ({
          cloudaicompanionProject: "project-123",
          currentTier: { id: "free-tier" },
        }),
      })
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID: cliID, methodID, inputs: {} })
      expect(attempt.mode).toBe("auto")

      const redirect = new URL(new URL(attempt.url).searchParams.get("redirect_uri")!)
      const state = new URL(attempt.url).searchParams.get("state")!
      redirect.searchParams.set("code", "the-code")
      redirect.searchParams.set("state", state)
      yield* Effect.promise(() => fetch(redirect))

      yield* eventually(integrations.attempt.status(attempt.attemptID), (status) => status.status === "complete")

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(cliID))[0]
      expect(stored?.value).toMatchObject({
        type: "oauth",
        methodID,
        access: "access-token",
        refresh: "refresh-token",
        metadata: { email: "person@example.com", projectID: "project-123", tier: "free-tier", clientProfile: "cli" },
      })
    }),
  )

  it.live("completes authorization manually when redirect URL or code is pasted", () =>
    Effect.gen(function* () {
      const http = mockHttp({
        "https://oauth2.googleapis.com/token": () => ({
          access_token: "manual-access-token",
          refresh_token: "manual-refresh-token",
          expires_in: 3600,
        }),
        "https://www.googleapis.com/oauth2/v1/userinfo": () => ({ email: "manual@example.com" }),
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist": () => ({
          cloudaicompanionProject: "project-manual",
          currentTier: { id: "free-tier" },
        }),
      })
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID: cliID, methodID, inputs: {} })
      expect(attempt.mode).toBe("auto")

      const redirectUri = new URL(attempt.url).searchParams.get("redirect_uri")!
      const pastedUrl = `${redirectUri}?code=manual-code-456&state=some-state`
      yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: pastedUrl })

      const status = yield* integrations.attempt.status(attempt.attemptID)
      expect(status.status).toBe("complete")

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(cliID))[0]
      expect(stored?.value).toMatchObject({
        type: "oauth",
        methodID,
        access: "manual-access-token",
        refresh: "manual-refresh-token",
        metadata: { email: "manual@example.com", projectID: "project-manual", tier: "free-tier", clientProfile: "cli" },
      })
    }),
  )

  it.effect("refreshes an expiring credential", () =>
    Effect.gen(function* () {
      const http = mockHttp({
        "https://oauth2.googleapis.com/token": () => ({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      })
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const stored = yield* credentials.create({
        integrationID: cliID,
        value: Credential.OAuth.make({ type: "oauth", methodID, access: "old-access", refresh: "old-refresh", expires: 1 }),
      })
      const resolved = yield* integrations.connection.resolve({ type: "credential", id: stored.id, label: stored.label })
      expect(resolved).toMatchObject({ access: "new-access", refresh: "new-refresh" })
    }),
  )
})
