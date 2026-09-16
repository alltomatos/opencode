import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { KiroPlugin } from "@opencode-ai/core/plugin/provider/kiro"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("kiro")
const builderIdMethodID = Integration.MethodID.make("builder-id")
const idcMethodID = Integration.MethodID.make("idc")
const socialMethodID = Integration.MethodID.make("social")
const importMethodID = Integration.MethodID.make("import")

const addPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  const client = yield* HttpClient.HttpClient
  yield* KiroPlugin.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integration),
    Effect.provideService(HttpClient.HttpClient, http ?? client),
  )
})

function json(request: HttpClientRequest.HttpClientRequest, body: unknown, status = 200) {
  return HttpClientResponse.fromWeb(request, Response.json(body, { status }))
}

function eventually<A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, remaining = 2000): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("KiroPlugin", () => {
  it.effect("registers all four auth methods on the same integration", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integration = yield* (yield* Integration.Service).get(integrationID)
      expect(integration?.methods.map((m) => (m.type === "oauth" ? m.id : m.type))).toEqual([
        builderIdMethodID,
        idcMethodID,
        socialMethodID,
        importMethodID,
      ])
      const idc = integration?.methods.find((m) => m.type === "oauth" && m.id === idcMethodID)
      expect(idc).toMatchObject({ prompts: [{ type: "text", key: "startUrl" }] })
    }),
  )

  it.effect("registers a connectable catalog card", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const catalog = yield* Catalog.Service
      const provider = yield* catalog.provider.get(ProviderV2.ID.make("kiro"))
      expect(provider?.name).toBe("Kiro")
      expect(provider?.integrationID).toBe(integrationID)
    }),
  )

  it.live("completes the Builder ID device flow and stores the fixed profile ARN", () =>
    Effect.gen(function* () {
      let polls = 0
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.url.endsWith("/client/register")) {
            return json(request, { clientId: "client-1", clientSecret: "secret-1" })
          }
          if (request.url.endsWith("/device_authorization")) {
            return json(request, {
              deviceCode: "device-code",
              userCode: "USER-CODE",
              verificationUri: "https://device.sso.amazonaws.com/",
              verificationUriComplete: "https://device.sso.amazonaws.com/?user_code=USER-CODE",
              expiresIn: 60,
              interval: 0,
            })
          }
          if (request.url.endsWith("/token")) {
            polls++
            if (polls < 2) return json(request, { __type: "AuthorizationPendingException" }, 400)
            return json(request, { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 })
          }
          throw new Error(`Unexpected request: ${request.url}`)
        }),
      )
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({
        integrationID,
        methodID: builderIdMethodID,
        inputs: {},
      })
      expect(attempt.url).toBe("https://device.sso.amazonaws.com/?user_code=USER-CODE")
      expect(attempt.instructions).toBe("Enter code: USER-CODE")

      yield* eventually(integrations.attempt.status(attempt.attemptID), (s) => s.status === "complete")

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(integrationID))[0]
      expect(stored?.value).toMatchObject({
        access: "access-1",
        refresh: "refresh-1",
        metadata: {
          authMethod: "builder-id",
          clientId: "client-1",
          clientSecret: "secret-1",
          profileArn: "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
        },
      })
    }),
  )

  it.effect("requires a start URL for IdC", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const error = yield* integrations.connection
        .oauth({ integrationID, methodID: idcMethodID, inputs: {} })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String((error as Integration.AuthorizationError).cause)).toContain("Start URL is required")
    }),
  )

  it.effect("re-registers the OIDC client and retries once when refresh is rejected", () =>
    Effect.gen(function* () {
      let registrations = 0
      let refreshAttempts = 0
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.url.endsWith("/client/register")) {
            registrations++
            return json(request, { clientId: `client-${registrations}`, clientSecret: `secret-${registrations}` })
          }
          if (request.url.endsWith("/token")) {
            refreshAttempts++
            if (refreshAttempts === 1) return json(request, { __type: "InvalidClientException" }, 400)
            return json(request, { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 })
          }
          throw new Error(`Unexpected request: ${request.url}`)
        }),
      )
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const stored = yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: builderIdMethodID,
          access: "old-access",
          refresh: "old-refresh",
          expires: 1,
          metadata: { authMethod: "builder-id", clientId: "stale-client", clientSecret: "stale-secret" },
        }),
      })
      const resolved = yield* integrations.connection.resolve({ type: "credential", id: stored.id, label: stored.label })
      expect(resolved).toMatchObject({ access: "new-access", refresh: "new-refresh" })
      expect(registrations).toBe(1)
    }),
  )

  it.effect("rejects an import token that doesn't look like an AWS SSO OIDC refresh token", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID, methodID: importMethodID, inputs: {} })
      expect(attempt.mode).toBe("code")
      const error = yield* integrations.attempt
        .complete({ attemptID: attempt.attemptID, code: "not-a-real-token" })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String((error as Integration.AuthorizationError).cause)).toContain("doesn't look like")
    }),
  )

  it.effect("imports a well-formed refresh token by redeeming it against a fresh OIDC client", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.url.endsWith("/client/register")) {
            return json(request, { clientId: "imported-client", clientSecret: "imported-secret" })
          }
          if (request.url.endsWith("/token")) {
            return json(request, { accessToken: "imported-access", refreshToken: "imported-refresh", expiresIn: 3600 })
          }
          throw new Error(`Unexpected request: ${request.url}`)
        }),
      )
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID, methodID: importMethodID, inputs: {} })
      yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: "aorAAAAAG-existing-token" })

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(integrationID))[0]
      expect(stored?.value).toMatchObject({ access: "imported-access", refresh: "imported-refresh" })
    }),
  )

  it.effect("exchanges a social login code against Kiro's own token endpoint", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.url.endsWith("/oauth/token")) {
            return json(request, { accessToken: "social-access", refreshToken: "social-refresh", expiresIn: 3600, email: "person@example.com" })
          }
          throw new Error(`Unexpected request: ${request.url}`)
        }),
      )
      yield* addPlugin(http)
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID, methodID: socialMethodID, inputs: {} })
      expect(attempt.mode).toBe("code")
      yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: "social-code" })

      const credentials = yield* Credential.Service
      const stored = (yield* credentials.list(integrationID))[0]
      expect(stored?.value).toMatchObject({
        access: "social-access",
        refresh: "social-refresh",
        metadata: {
          authMethod: "social",
          profileArn: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
          email: "person@example.com",
        },
      })
    }),
  )
})
