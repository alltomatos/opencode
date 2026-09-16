import { Duration, Effect, Schema } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider"

// Device-auth flow, base URL, header names and the "anonymous" fallback key
// are taken verbatim from Kilo Code's own client
// (github.com/Kilo-Org/kilocode: packages/kilo-gateway/src/auth/device.ts +
// api/constants.ts) — Kilo's device-auth codes endpoint has no client_id at
// all, and the issued token carries no refresh token or expiry.
const apiBase = "https://api.kilo.ai"
const anonymousApiKey = "anonymous"
const editorNameHeader = "X-KILOCODE-EDITORNAME"
const editorName = "opencode"

const integrationID = Integration.ID.make("kilo")
const methodID = Integration.MethodID.make("device")
const providerID = ProviderV2.ID.make("kilo")

const InitiateResponse = Schema.Struct({
  code: Schema.String,
  verificationUrl: Schema.String,
  expiresIn: Schema.Number,
})
const PollApproved = Schema.Struct({
  status: Schema.Literal("approved"),
  token: Schema.String,
  userEmail: Schema.optional(Schema.String),
})

const pollInterval = Duration.seconds(2)

function poll(http: HttpClient.HttpClient, code: string, deadline: number): Effect.Effect<Credential.OAuth, unknown> {
  return Effect.gen(function* () {
    if (Date.now() >= deadline) return yield* Effect.fail(new Error("Device authorization expired"))
    yield* Effect.sleep(pollInterval)
    const response = yield* http.execute(
      HttpClientRequest.get(`${apiBase}/api/device-auth/codes/${code}`).pipe(HttpClientRequest.acceptJson),
    )
    if (response.status === 202) return yield* poll(http, code, deadline)
    if (response.status === 403) return yield* Effect.fail(new Error("Device authorization was denied"))
    if (response.status === 410) return yield* Effect.fail(new Error("Device authorization expired"))
    const approved = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(PollApproved)),
    )
    return Credential.OAuth.make({
      type: "oauth" as const,
      methodID,
      access: approved.token,
      refresh: "",
      expires: 0,
      metadata: approved.userEmail ? { email: approved.userEmail } : undefined,
    })
  })
}

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID,
    method: {
      id: methodID,
      type: "oauth",
      label: "Kilo Code account",
    },
    authorize: () =>
      Effect.gen(function* () {
        const response = yield* http.execute(
          HttpClientRequest.post(`${apiBase}/api/device-auth/codes`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("Content-Type", "application/json"),
          ),
        )
        if (response.status === 429) {
          return yield* Effect.fail(new Error("Too many pending Kilo Code authorization requests. Try again shortly."))
        }
        const device = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(InitiateResponse)),
        )
        return {
          mode: "auto" as const,
          url: device.verificationUrl,
          instructions: `Enter code: ${device.code}`,
          callback: poll(http, device.code, Date.now() + device.expiresIn * 1000),
        }
      }),
    // Kilo's device tokens carry no refresh token or expiry — nothing to refresh.
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

export const KiloPlugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "kilo",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      draft.update(integrationID, (integration) => {
        integration.name = "Kilo Code"
      })
      draft.method.update(oauth(http))
    })

    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const item = evt.provider.get(providerID)
        if (!item) return
        if (item.provider.api.type !== "aisdk") return
        if (item.provider.api.package !== "@ai-sdk/openai-compatible") return
        if (item.provider.api.url !== "https://api.kilo.ai/api/gateway") return

        // No connected account: fall back to Kilo's keyless free tier
        // instead of leaving the provider unusable, mirroring Kilo's own
        // ANONYMOUS_API_KEY behavior.
        const connection = yield* ctx.integration.connection.active(integrationID)
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
        const apiKey = credential?.type === "oauth" ? credential.access : (credential?.type === "key" ? credential.key : undefined)

        evt.provider.update(item.provider.id, (provider) => {
          provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
          provider.request.headers["X-Title"] = "opencode"
          provider.request.headers[editorNameHeader] = editorName
          provider.request.body.apiKey = apiKey ?? anonymousApiKey
        })
      }),
    )
  }),
})
