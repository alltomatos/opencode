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
const qDeveloperEndpoint = "https://q.us-east-1.amazonaws.com"
const builderIdStartUrl = "https://view.awsapps.com/start"
const socialAuthEndpoint = "https://prod.us-east-1.auth.desktop.kiro.dev"
const socialAuthorizeUrl = "https://prod.us-east-1.auth.desktop.kiro.dev/authorize"
const scopes = ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"]

const builderIdProfileArn = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX"
const socialProfileArn = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"

const integrationID = Integration.ID.make("kiro")
const builderIdMethodID = Integration.MethodID.make("builder-id")
const idcMethodID = Integration.MethodID.make("idc")
const socialMethodID = Integration.MethodID.make("social")
const importMethodID = Integration.MethodID.make("import")

type AuthMethod = "builder-id" | "idc" | "social"

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
    const body = yield* HttpClientResponse.schemaBodyJson(Schema.Struct({ __type: Schema.optional(Schema.String) }))(
      response,
    ).pipe(Effect.catch(() => Effect.succeed({ __type: undefined })))
    if (body.__type === "AuthorizationPendingException") {
      return yield* pollDeviceToken(http, clientId, clientSecret, deviceCode, interval, deadline)
    }
    if (body.__type === "SlowDownException") {
      return yield* pollDeviceToken(http, clientId, clientSecret, deviceCode, interval + 5, deadline)
    }
    return yield* Effect.fail(new Error(`Device authorization failed: ${body.__type ?? response.status}`))
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

// -- Q Developer / CodeWhisperer profile discovery (IdC only) ------------

const ListProfilesResponse = Schema.Struct({
  profiles: Schema.optional(Schema.Array(Schema.Struct({ arn: Schema.String }))),
})

// Best-effort: IdC accounts need a region-bound profileArn on every
// CodeWhisperer call, discovered via the AmazonCodeWhispererService
// ListAvailableProfiles JSON-RPC operation (bearer-token authenticated).
// Never blocks login — a missing profileArn just means it's resolved lazily
// on first real request.
function discoverProfileArn(http: HttpClient.HttpClient, accessToken: string) {
  return http
    .execute(
      HttpClientRequest.post(qDeveloperEndpoint).pipe(
        HttpClientRequest.bearerToken(accessToken),
        HttpClientRequest.setHeader("content-type", "application/x-amz-json-1.0"),
        HttpClientRequest.setHeader("x-amz-target", "AmazonCodeWhispererService.ListAvailableProfiles"),
        HttpClientRequest.bodyJsonUnsafe({}),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ListProfilesResponse)),
      Effect.map((result) => result.profiles?.[0]?.arn),
      Effect.catch(() => Effect.succeed(undefined)),
    )
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

// -- Builder ID / IdC (shared device-code machinery) ----------------------

function deviceMethod(http: HttpClient.HttpClient, methodID: Integration.MethodID, authMethod: "builder-id" | "idc") {
  return {
    integrationID,
    method:
      authMethod === "builder-id"
        ? { id: methodID, type: "oauth", label: "AWS Builder ID" }
        : {
            id: methodID,
            type: "oauth",
            label: "AWS IAM Identity Center",
            prompts: [
              {
                type: "text" as const,
                key: "startUrl",
                message: "AWS IAM Identity Center start URL",
                placeholder: "https://my-org.awsapps.com/start",
              },
            ],
          },
    authorize: (inputs) =>
      Effect.gen(function* () {
        const startUrl = authMethod === "idc" ? inputs.startUrl : builderIdStartUrl
        if (authMethod === "idc" && !startUrl) return yield* Effect.fail(new Error("Start URL is required"))
        const client = yield* registerClient(http)
        const device = yield* startDeviceAuthorization(http, client.clientId, client.clientSecret, startUrl)
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
            const profileArn =
              authMethod === "builder-id" ? builderIdProfileArn : yield* discoverProfileArn(http, token.accessToken)
            return credentialFromToken(methodID, authMethod, client.clientId, client.clientSecret, token, { profileArn })
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
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

// -- Social login (Google / GitHub via Kiro's own backend) ----------------
//
// Kiro's AuthServiceClient (confirmed in the installed extension bundle)
// exchanges an authorization code for tokens at `${endpoint}/oauth/token`
// and refreshes at `${endpoint}/refreshToken`. The browser-facing authorize
// URL that starts the Google/GitHub consent flow lives in Kiro's Electron
// shell (not the extension bundle we could inspect), so it's approximated
// here rather than confirmed — treat this method as best-effort until that
// URL is verified against a real login.
function social(http: HttpClient.HttpClient) {
  return {
    integrationID,
    method: { id: socialMethodID, type: "oauth", label: "Google or GitHub (social login)" },
    authorize: () =>
      Effect.gen(function* () {
        const verifier = crypto.randomUUID() + crypto.randomUUID()
        const challenge = Buffer.from(
          yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
        ).toString("base64url")
        const state = crypto.randomUUID()
        const url = new URL(socialAuthorizeUrl)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("code_challenge", challenge)
        url.searchParams.set("code_challenge_method", "S256")
        url.searchParams.set("state", state)
        return {
          mode: "code" as const,
          url: url.href,
          instructions: "Sign in with Google or GitHub, then paste the `code` from the redirect URL here.",
          callback: (code: string) =>
            Effect.gen(function* () {
              const value = code.includes("code=") ? new URL(code).searchParams.get("code")! : code
              const response = yield* HttpClient.filterStatusOk(http)
                .execute(
                  HttpClientRequest.post(`${socialAuthEndpoint}/oauth/token`).pipe(
                    HttpClientRequest.acceptJson,
                    HttpClientRequest.bodyJsonUnsafe({ code: value, code_verifier: verifier, redirect_uri: url.href }),
                  ),
                )
                .pipe(
                  Effect.flatMap(
                    HttpClientResponse.schemaBodyJson(
                      Schema.Struct({
                        accessToken: Schema.String,
                        refreshToken: Schema.optional(Schema.String),
                        expiresIn: Schema.optional(Schema.Number),
                        email: Schema.optional(Schema.String),
                      }),
                    ),
                  ),
                )
              return Credential.OAuth.make({
                type: "oauth" as const,
                methodID: socialMethodID,
                access: response.accessToken,
                refresh: response.refreshToken ?? "",
                expires: Date.now() + (response.expiresIn ?? 3600) * 1000,
                metadata: {
                  authMethod: "social" as const,
                  profileArn: socialProfileArn,
                  ...(response.email ? { email: response.email } : {}),
                },
              })
            }),
        }
      }),
    refresh: (credential) =>
      HttpClient.filterStatusOk(http)
        .execute(
          HttpClientRequest.post(`${socialAuthEndpoint}/refreshToken`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyJsonUnsafe({ refreshToken: credential.refresh }),
          ),
        )
        .pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({
                accessToken: Schema.String,
                refreshToken: Schema.optional(Schema.String),
                expiresIn: Schema.optional(Schema.Number),
              }),
            ),
          ),
          Effect.map((token) => ({
            ...credential,
            access: token.accessToken,
            refresh: token.refreshToken ?? credential.refresh,
            expires: Date.now() + (token.expiresIn ?? 3600) * 1000,
          })),
        ),
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

// -- Import (paste an existing refresh token) ------------------------------
//
// Validates the pasted token against AWS SSO OIDC's known refresh-token
// prefix and self-registers an isolated OIDC client to redeem it — kept
// isolated (rather than reusing another connection's client) so importing
// several accounts never shares one backend session.
function importToken(http: HttpClient.HttpClient) {
  return {
    integrationID,
    method: { id: importMethodID, type: "oauth", label: "Import an existing refresh token" },
    authorize: () =>
      Effect.succeed({
        mode: "code" as const,
        url: "https://docs.aws.amazon.com/singlesignon/latest/userguide/get-set-up-for-idc.html",
        instructions: "Paste an existing AWS SSO OIDC refresh token (starts with `aorAAAAAG`).",
        callback: (code: string) =>
          Effect.gen(function* () {
            const token = code.trim()
            if (!token.startsWith("aorAAAAAG")) {
              return yield* Effect.fail(new Error("This doesn't look like an AWS SSO OIDC refresh token"))
            }
            const client = yield* registerClient(http)
            const refreshed = yield* refreshOidcToken(http, client.clientId, client.clientSecret, token)
            return credentialFromToken(
              importMethodID,
              "builder-id",
              client.clientId,
              client.clientSecret,
              { ...refreshed, refreshToken: refreshed.refreshToken ?? token },
              { profileArn: builderIdProfileArn },
            )
          }),
      }),
    refresh: (credential) =>
      Effect.gen(function* () {
        const clientId = typeof credential.metadata?.clientId === "string" ? credential.metadata.clientId : undefined
        const clientSecret =
          typeof credential.metadata?.clientSecret === "string" ? credential.metadata.clientSecret : undefined
        if (!clientId || !clientSecret) return yield* Effect.fail(new Error("Missing AWS SSO OIDC client credentials"))
        const token = yield* refreshOidcToken(http, clientId, clientSecret, credential.refresh)
        return {
          ...credential,
          access: token.accessToken,
          refresh: token.refreshToken ?? credential.refresh,
          expires: Date.now() + token.expiresIn * 1000,
        }
      }),
    label: () => "Imported token",
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
      draft.method.update(deviceMethod(http, builderIdMethodID, "builder-id"))
      draft.method.update(deviceMethod(http, idcMethodID, "idc"))
      draft.method.update(social(http))
      draft.method.update(importToken(http))
    })
    // Registers a connectable card in the provider catalog — without a
    // catalog.provider entry the "Connect a provider" picker has nothing to
    // show, so OAuth would be unreachable from the UI. No chat/completions
    // adapter is wired for the CodeWhisperer protocol yet (see kilo.ts /
    // google-antigravity.ts for the same scope boundary).
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(ProviderV2.ID.make(integrationID), (provider) => {
        provider.name = "Kiro"
        provider.integrationID = integrationID
      })
    })
  }),
})
