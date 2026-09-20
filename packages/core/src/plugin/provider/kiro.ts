import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider"

// Endpoints, header/target names, and the fixed profile ARNs below were
// extracted directly from the locally installed Kiro IDE
// (kiro.kiro-agent extension bundle, dist/extension.js) — it bundles the
// real @aws-sdk/nested-clients/sso-oidc client (so Builder ID / IdC are the
// standard, public AWS SSO OIDC device-authorization flow) and its own
// AuthServiceClient for social login, whose `/oauth/token` and
// `/refreshToken` endpoints and fixed CodeWhisperer profile ARNs (BuilderId,
// Github/Google share one) were read straight out of that bundle. The one
// piece NOT found in the installed bundle (it's handled natively inside the
// Electron shell, not the VS Code extension) is the browser-facing
// authorize URL for the Google/GitHub social flow — that one is inferred
// from third-party reverse-engineering (OmniRoute's kiro provider) rather
// than independently confirmed here, and should be treated as best-effort.
const ssoOidcRegion = "us-east-1"
const builderIdStartUrl = "https://view.awsapps.com/start"
const scopes = ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"]

const builderIdProfileArn = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX"

const integrationID = Integration.ID.make("kiro")
const builderIdMethodID = Integration.MethodID.make("builder-id")

type AuthMethod = "builder-id"

// -- AWS SSO OIDC (Builder ID / IdC) --------------------------------------

const RegisterClientResponse = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
})
const DeviceAuthorizationResponse = Schema.Struct({
  deviceCode: Schema.String,
  userCode: Schema.String,
  verificationUri: Schema.String,
  verificationUriComplete: Schema.optional(Schema.String),
  expiresIn: Schema.Number,
  interval: Schema.optional(Schema.Number),
})
const TokenResponse = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresIn: Schema.Number,
})

function oidcUrl(path: string) {
  return `https://oidc.${ssoOidcRegion}.amazonaws.com/${path}`
}

function registerClient(http: HttpClient.HttpClient) {
  return HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.post(oidcUrl("client/register")).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJsonUnsafe({ clientName: "opencode", clientType: "public", scopes }),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RegisterClientResponse)))
}

function startDeviceAuthorization(http: HttpClient.HttpClient, clientId: string, clientSecret: string, startUrl: string) {
  return HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.post(oidcUrl("device_authorization")).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJsonUnsafe({ clientId, clientSecret, startUrl }),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(DeviceAuthorizationResponse)))
}

// AWS SSO OIDC's CreateToken returns a 4xx with an `__type` like
// AuthorizationPendingException/SlowDownException/ExpiredTokenException
// while the device code hasn't been approved yet — those aren't real
// failures, they're the poll loop's "not yet" signal.
function createTokenOnce(http: HttpClient.HttpClient, body: Record<string, unknown>) {
  return http.execute(
    HttpClientRequest.post(oidcUrl("token")).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bodyJsonUnsafe(body)),
  )
}

function pollDeviceToken(
  http: HttpClient.HttpClient,
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  interval: number,
  deadline: number,
): Effect.Effect<{ accessToken: string; refreshToken?: string; expiresIn: number }, unknown> {
  return Effect.gen(function* () {
    if (Date.now() >= deadline) return yield* Effect.fail(new Error("Device authorization expired"))
    yield* Effect.sleep(interval * 1000)
    const response = yield* createTokenOnce(http, {
      clientId,
      clientSecret,
      grantType: "urn:ietf:params:oauth:grant-type:device_code",
      deviceCode,
    })
    if (response.status >= 200 && response.status < 300) {
      return yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
    }
    const rawBody = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
    // AWS SSO OIDC's CreateToken speaks the OAuth2 device-flow error shape
    // (`{"error": "authorization_pending"}`, snake_case) here, not the
    // JSON-RPC `__type` shape other AWS services use — checking `__type`
    // meant every "still waiting" poll (including the very first one) was
    // wrongly treated as a hard failure instead of "poll again".
    const body = ((): { error?: string } => {
      try {
        return JSON.parse(rawBody)
      } catch {
        return {}
      }
    })()
    if (body.error === "authorization_pending") {
      return yield* pollDeviceToken(http, clientId, clientSecret, deviceCode, interval, deadline)
    }
    if (body.error === "slow_down") {
      return yield* pollDeviceToken(http, clientId, clientSecret, deviceCode, interval + 5, deadline)
    }
    return yield* Effect.fail(new Error(`Device authorization failed: ${body.error ?? response.status}`))
  })
}

function refreshOidcToken(http: HttpClient.HttpClient, clientId: string, clientSecret: string, refreshToken: string) {
  return HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.post(oidcUrl("token")).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJsonUnsafe({ clientId, clientSecret, grantType: "refresh_token", refreshToken }),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)))
}

// -- Credential helpers ----------------------------------------------------

function credentialFromToken(
  methodID: Integration.MethodID,
  authMethod: AuthMethod,
  clientId: string,
  clientSecret: string,
  token: { accessToken: string; refreshToken?: string; expiresIn: number },
  extra?: { email?: string; profileArn?: string; region?: string },
) {
  return Credential.OAuth.make({
    type: "oauth" as const,
    methodID,
    access: token.accessToken,
    refresh: token.refreshToken ?? "",
    expires: Date.now() + token.expiresIn * 1000,
    metadata: {
      authMethod,
      clientId,
      clientSecret,
      region: extra?.region ?? ssoOidcRegion,
      ...(extra?.email ? { email: extra.email } : {}),
      ...(extra?.profileArn ? { profileArn: extra.profileArn } : {}),
    },
  })
}

// -- Builder ID device-code method -----------------------------------------

function deviceMethod(http: HttpClient.HttpClient, methodID: Integration.MethodID) {
  return {
    integrationID,
    method: { id: methodID, type: "oauth", label: "AWS Builder ID" },
    authorize: () =>
      Effect.gen(function* () {
        const client = yield* registerClient(http)
        const device = yield* startDeviceAuthorization(http, client.clientId, client.clientSecret, builderIdStartUrl)
        const deadline = Date.now() + device.expiresIn * 1000
        return {
          mode: "auto" as const,
          url: device.verificationUriComplete ?? device.verificationUri,
          instructions: `Enter code: ${device.userCode}`,
          callback: Effect.gen(function* () {
            const token = yield* pollDeviceToken(
              http,
              client.clientId,
              client.clientSecret,
              device.deviceCode,
              device.interval ?? 5,
              deadline,
            )
            return credentialFromToken(methodID, "builder-id", client.clientId, client.clientSecret, token, {
              profileArn: builderIdProfileArn,
            })
          }),
        }
      }),
    refresh: (credential) =>
      Effect.gen(function* () {
        const clientId = typeof credential.metadata?.clientId === "string" ? credential.metadata.clientId : undefined
        const clientSecret =
          typeof credential.metadata?.clientSecret === "string" ? credential.metadata.clientSecret : undefined
        if (!clientId || !clientSecret) return yield* Effect.fail(new Error("Missing AWS SSO OIDC client credentials"))

        const attempt = (id: string, secret: string) => refreshOidcToken(http, id, secret, credential.refresh)
        // The registered OIDC client itself can expire independently of the
        // refresh token; when that happens AWS rejects the refresh call, so
        // re-register a fresh client and retry once with the same refresh
        // token before giving up.
        const token = yield* attempt(clientId, clientSecret).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              const client = yield* registerClient(http)
              const refreshed = yield* attempt(client.clientId, client.clientSecret)
              return { ...refreshed, _client: client }
            }),
          ),
        )
        const rotated = "_client" in token ? (token as { _client: { clientId: string; clientSecret: string } })._client : undefined
        return {
          ...credential,
          access: token.accessToken,
          refresh: token.refreshToken ?? credential.refresh,
          expires: Date.now() + token.expiresIn * 1000,
          metadata: {
            ...credential.metadata,
            clientId: rotated?.clientId ?? clientId,
            clientSecret: rotated?.clientSecret ?? clientSecret,
          },
        }
      }),
    label: (credential) =>
      typeof credential.metadata?.email === "string"
        ? credential.metadata.email
        : typeof credential.metadata?.clientId === "string"
          ? `Builder ID (${credential.metadata.clientId.slice(-8)})`
          : undefined,
  } satisfies IntegrationOAuthMethodRegistration
}

export const KiroPlugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "kiro",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      draft.update(integrationID, (integration) => {
        integration.name = "Kiro"
      })
      draft.method.update(deviceMethod(http, builderIdMethodID))
    })
    // Registers a connectable card in the provider catalog — without a
    // catalog.provider entry the "Connect a provider" picker has nothing to
    // show, so OAuth would be unreachable from the UI. No chat/completions
    // adapter is wired for the CodeWhisperer protocol yet (see kilo.ts /
    // google-antigravity.ts for the same scope boundary — and, like
    // Antigravity, this catalog registration alone does NOT reach real chat
    // calls; that needs its own v1 bridge injection in
    // packages/opencode/src/provider/provider.ts once the wire adapter exists).
    yield* ctx.catalog.transform((catalog) => {
      const providerID = ProviderV2.ID.make(integrationID)
      catalog.provider.update(providerID, (provider) => {
        provider.name = "Kiro"
        provider.integrationID = integrationID
        // "@ai-sdk/anthropic" was a placeholder — real inference now happens
        // through a custom fetch adapter (packages/opencode/src/provider/kiro-adapter.ts)
        // wired via Provider.syncCatalogModel, which disguises the wire call as
        // an "@ai-sdk/openai-compatible" chat-completions request and translates
        // it to/from Kiro's real AWS CodeWhisperer envelope. openai-compatible's
        // flat message list + tool_calls/tool_result shape maps far more directly
        // onto Kiro's own request/response shape than Anthropic's content blocks do.
        // A real (if unused) URL matters here: the v1 custom() loader that
        // would normally supply a placeholder baseURL never runs for
        // catalog-only providers like this one (nothing in the static
        // models.dev/config database), so this is the only baseURL the SDK
        // sees before createKiroFetch intercepts the request — leaving it
        // unset makes @ai-sdk/openai-compatible build a bare "/chat/completions"
        // path with no origin, which crashes on fetch with "Invalid URL".
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://codewhisperer.us-east-1.amazonaws.com/v1-fake",
        }
      })

      // Model IDs and context/output limits below come from Kiro's live
      // upstream catalog (cross-checked against OmniRoute's kiro provider
      // registry, D:\dev\OmniRoute\open-sse\config\providers\registry\kiro —
      // sending an unknown id makes CodeWhisperer return
      // `400 "Invalid model. Please select a different model"`, so these are
      // NOT guessed). claude-sonnet-5 is real but plan-gated per account.
      const models: { id: string; name: string; context?: number; output?: number }[] = [
        { id: "claude-sonnet-5", name: "Claude Sonnet 5", context: 1_000_000, output: 128_000 },
        { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", context: 200_000, output: 64_000 },
        { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", context: 200_000, output: 64_000 },
        { id: "deepseek-3.2", name: "DeepSeek V3.2" },
        { id: "minimax-m2.5", name: "MiniMax M2.5" },
        { id: "minimax-m2.1", name: "MiniMax M2.1" },
        { id: "glm-5", name: "GLM-5" },
        { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
        { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context: 272_000, output: 128_000 },
        { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", context: 272_000, output: 128_000 },
        { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", context: 272_000, output: 128_000 },
      ]

      for (const m of models) {
        catalog.model.update(providerID, m.id, (draft) => {
          draft.name = m.name
          draft.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
          draft.status = "active"
          draft.enabled = true
          draft.limit = {
            context: m.context ?? 200_000,
            input: m.context ?? 200_000,
            output: m.output ?? 64_000,
          }
        })
      }
    })
  }),
})
