import { createServer } from "node:http"
import { Deferred, Effect, Schema } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"

// Google's official Antigravity IDE and its bundled `agy` CLI ship as two
// separate OAuth clients (confirmed by extracting both from the installed
// binaries: Antigravity.exe / language_server.exe for the IDE, agy.EXE for
// the CLI — both binaries embed both client pairs, but each is the primary
// one for its own product). Antigravity's client_id is independently
// corroborated by OmniRoute's reverse-engineered provider config
// (D:\dev\OmniRoute src/lib/oauth/constants/oauth.ts), which uses the exact
// same value for its "agy" provider. These are native/installed-app OAuth
// clients — protected by the loopback redirect + consent screen, not by the
// secret staying secret (the official binaries ship it in plaintext too) —
// so baking in the officially-observed defaults here matches how the real
// clients behave. Both remain overridable via env for anyone using a
// different registration.
const authorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth"
const tokenUrl = "https://oauth2.googleapis.com/token"
const userInfoUrl = "https://www.googleapis.com/oauth2/v1/userinfo"
const loadCodeAssistUrl = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
const onboardUserUrl = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser"

const scopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
]

type ClientProfile = "ide" | "cli"

type Profile = {
  integrationID: Integration.ID
  methodID: Integration.MethodID
  label: string
  providerName: string
  clientProfile: ClientProfile
  clientID: string | undefined
  clientSecret: string | undefined
}

function profiles(): Profile[] {
  return [
    {
      integrationID: Integration.ID.make("google-antigravity"),
      methodID: Integration.MethodID.make("oauth"),
      label: "Google account",
      providerName: "Google Antigravity",
      clientProfile: "ide",
      clientID:
        process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? "884354919052-36trc1jjb3tguiac32ov6cod268c5blh.apps.googleusercontent.com",
      clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? "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",
    },
    {
      integrationID: Integration.ID.make("google-antigravity-cli"),
      methodID: Integration.MethodID.make("oauth"),
      label: "Google account",
      providerName: "Google Antigravity CLI",
      clientProfile: "cli",
      clientID:
        process.env.AGY_OAUTH_CLIENT_ID ?? "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
      clientSecret: process.env.AGY_OAUTH_CLIENT_SECRET ?? "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",
    },
  ]
}

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
})
const UserInfo = Schema.Struct({ email: Schema.String })
const LoadCodeAssistResponse = Schema.Struct({
  cloudaicompanionProject: Schema.optional(Schema.String),
  currentTier: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String) })),
})
const OnboardUserResponse = Schema.Struct({
  response: Schema.optional(Schema.Struct({ cloudaicompanionProject: Schema.optional(Schema.String) })),
})

function post<S extends Schema.Top>(http: HttpClient.HttpClient, url: string, token: string, body: unknown, schema: S) {
  return HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
}

function get<S extends Schema.Top>(http: HttpClient.HttpClient, url: string, token: string, schema: S) {
  return HttpClient.filterStatusOk(http)
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(token)))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
}

// Discovers (or provisions, for brand-new accounts) the Cloud Code project
// backing this account. Required on every Code Assist call — the token
// alone isn't enough. Best-effort: a failure here still leaves the account
// usable, since onboarding can complete lazily on the first real request.
function discoverProject(http: HttpClient.HttpClient, accessToken: string) {
  return Effect.gen(function* () {
    const loaded = yield* post(
      http,
      loadCodeAssistUrl,
      accessToken,
      { metadata: { pluginType: "GEMINI" } },
      LoadCodeAssistResponse,
    )
    if (loaded.cloudaicompanionProject) {
      return { projectID: loaded.cloudaicompanionProject, tier: loaded.currentTier?.id }
    }
    const onboarded = yield* post(
      http,
      onboardUserUrl,
      accessToken,
      { tierId: loaded.currentTier?.id ?? "free-tier", metadata: { pluginType: "GEMINI" } },
      OnboardUserResponse,
    )
    return { projectID: onboarded.response?.cloudaicompanionProject, tier: loaded.currentTier?.id }
  }).pipe(Effect.catch(() => Effect.succeed({ projectID: undefined, tier: undefined })))
}

function exchange(
  http: HttpClient.HttpClient,
  profile: Profile,
  redirectUri: string,
  code: string,
  verifier: string,
) {
  return Effect.gen(function* () {
    const token = yield* HttpClient.filterStatusOk(http)
      .execute(
        HttpClientRequest.post(tokenUrl).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyUrlParams({
            code,
            client_id: profile.clientID!,
            client_secret: profile.clientSecret!,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: verifier,
          }),
        ),
      )
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)))

    const [userInfo, project] = yield* Effect.all(
      [
        get(http, userInfoUrl, token.access_token, UserInfo).pipe(
          Effect.catch(() => Effect.succeed({ email: undefined as string | undefined })),
        ),
        discoverProject(http, token.access_token),
      ],
      { concurrency: 2 },
    )

    return Credential.OAuth.make({
      type: "oauth" as const,
      methodID: profile.methodID,
      access: token.access_token,
      refresh: token.refresh_token ?? "",
      expires: Date.now() + token.expires_in * 1000,
      metadata: {
        email: userInfo.email,
        projectID: project.projectID,
        tier: project.tier,
        clientProfile: profile.clientProfile,
      },
    })
  })
}

async function generatePkce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)), (byte) => chars[byte % chars.length]).join(
    "",
  )
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(digest).toString("base64url") }
}

function oauth(http: HttpClient.HttpClient, profile: Profile) {
  return {
    integrationID: profile.integrationID,
    method: {
      id: profile.methodID,
      type: "oauth",
      label: profile.label,
    },
    authorize: () =>
      Effect.gen(function* () {
        if (!profile.clientID || !profile.clientSecret) {
          return yield* Effect.fail(new Error(`${profile.providerName} OAuth client is not configured.`))
        }
        const pkce = yield* Effect.promise(generatePkce)
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
        const code = yield* Deferred.make<string, Error>()
        const path = "/oauth2callback"

        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== path) {
            response.writeHead(404).end("Not found")
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(code, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: profile.providerName }))
            return
          }
          if (!value || url.searchParams.get("state") !== state) {
            const message = value ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(code, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: profile.providerName }))
            return
          }
          Effect.runFork(Deferred.succeed(code, value))
          response
            .writeHead(200, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.success({ provider: profile.providerName }))
        })

        const port = yield* Effect.callback<number, Error>((resume) => {
          server.once("error", (error) => resume(Effect.fail(error)))
          server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            resume(
              typeof address === "object" && address
                ? Effect.succeed(address.port)
                : Effect.fail(new Error("Failed to bind loopback OAuth listener")),
            )
          })
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))

        const redirectUri = `http://127.0.0.1:${port}${path}`
        const url = new URL(authorizeUrl)
        url.searchParams.set("client_id", profile.clientID)
        url.searchParams.set("redirect_uri", redirectUri)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("scope", scopes.join(" "))
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("prompt", "consent")
        url.searchParams.set("code_challenge", pkce.challenge)
        url.searchParams.set("code_challenge_method", "S256")
        url.searchParams.set("state", state)

        return {
          mode: "auto" as const,
          url: url.href,
          instructions: "Complete authorization in your browser. This window will close automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) => exchange(http, profile, redirectUri, value, pkce.verifier)),
          ),
        }
      }),
    refresh: (credential) =>
      Effect.gen(function* () {
        if (!profile.clientID || !profile.clientSecret) {
          return yield* Effect.fail(new Error(`${profile.providerName} OAuth client is not configured.`))
        }
        const token = yield* HttpClient.filterStatusOk(http)
          .execute(
            HttpClientRequest.post(tokenUrl).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.bodyUrlParams({
                refresh_token: credential.refresh,
                client_id: profile.clientID,
                client_secret: profile.clientSecret,
                grant_type: "refresh_token",
              }),
            ),
          )
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)))
        return {
          ...credential,
          access: token.access_token,
          refresh: token.refresh_token ?? credential.refresh,
          expires: Date.now() + token.expires_in * 1000,
        }
      }),
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

// NOTE: this registers OAuth + credential storage only. The Code Assist wire
// protocol (`:generateContent`/`:streamGenerateContent` over the discovered
// project) is a distinct, proprietary request/response shape — wiring an
// inference adapter for it is separate follow-up work, the same way GitHub
// Copilot needed its own bespoke provider module instead of the generic
// aisdk/native dispatch.
export const GoogleAntigravityPlugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "google-antigravity",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      for (const profile of profiles()) {
        draft.update(profile.integrationID, (integration) => {
          integration.name = profile.providerName
        })
        draft.method.update(oauth(http, profile))
      }
    })
  }),
})
