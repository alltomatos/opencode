// The vendored @opencode-ai/client tarball (packages/app/vendor) predates the
// Integration/Credential API — it has no generated client for `/api/integration/*`
// and `/api/credential/*`, so `serverSDK().api.integration.*` resolves those
// calls as bare relative paths (fetched against the app's own origin instead
// of the actual server), always returning the app's index.html. Bumping the
// vendor tarball to a build that has this API drags in dozens of unrelated
// breaking changes from upstream (see git history around this file for
// context) — until that's tackled as its own migration, these few
// Integration/Credential calls are implemented here as plain fetches against
// the real server URL instead, matching the wire format
// packages/server/src/handlers/integration.ts and credential.ts actually
// speak. Drop this file once the vendored client is refreshed.
import type {
  IntegrationAttemptStatus,
  IntegrationInfo,
  IntegrationOauthConnectOutput,
} from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

type Location = { directory?: string } | undefined

function authHeaders(http: ServerConnection.HttpBase): HeadersInit {
  if (!http.password) return {}
  return { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
}

function withLocation(url: URL, location: Location) {
  if (location?.directory) url.searchParams.set("location[directory]", location.directory)
  return url
}

async function request<T>(
  http: ServerConnection.HttpBase,
  method: string,
  path: string,
  options: { location?: Location; body?: unknown } = {},
): Promise<{ data: T }> {
  const url = withLocation(new URL(path, http.url), options.location)
  const response = await fetch(url, {
    method,
    headers: {
      ...authHeaders(http),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const json = await response.json().catch(() => undefined)
  if (!response.ok) throw { data: json ?? { message: response.statusText } }
  return json as { data: T }
}

export function createIntegrationFetchApi(http: ServerConnection.HttpBase) {
  return {
    integration: {
      list: (params: { location?: Location } = {}) =>
        request<IntegrationInfo[]>(http, "GET", "/api/integration", {
          location: params.location,
        }),
      get: (params: { integrationID: string; location?: Location }) =>
        request<IntegrationInfo>(http, "GET", `/api/integration/${encodeURIComponent(params.integrationID)}`, {
          location: params.location,
        }),
      connect: {
        key: (params: { integrationID: string; key: string; label?: string; location?: Location }) =>
          request(http, "POST", `/api/integration/${encodeURIComponent(params.integrationID)}/connect/key`, {
            location: params.location,
            body: { key: params.key, label: params.label },
          }),
      },
      oauth: {
        connect: (params: {
          integrationID: string
          methodID: string
          inputs: Record<string, string>
          label?: string
          location?: Location
        }) =>
          request<IntegrationOauthConnectOutput["data"]>(
            http,
            "POST",
            `/api/integration/${encodeURIComponent(params.integrationID)}/connect/oauth`,
            {
              location: params.location,
              body: { methodID: params.methodID, inputs: params.inputs, label: params.label },
            },
          ),
        status: (params: { attemptID: string; location?: Location }) =>
          request<IntegrationAttemptStatus>(http, "GET", `/api/integration/attempt/${encodeURIComponent(params.attemptID)}`, {
            location: params.location,
          }),
        complete: (params: { attemptID: string; code?: string; location?: Location }) =>
          request(http, "POST", `/api/integration/attempt/${encodeURIComponent(params.attemptID)}/complete`, {
            location: params.location,
            body: { code: params.code },
          }),
        cancel: (params: { attemptID: string; location?: Location }) =>
          request(http, "DELETE", `/api/integration/attempt/${encodeURIComponent(params.attemptID)}`, {
            location: params.location,
          }),
      },
    },
    credential: {
      remove: (params: { credentialID: string; location?: Location }) =>
        request(http, "DELETE", `/api/credential/${encodeURIComponent(params.credentialID)}`, {
          location: params.location,
        }),
      update: (params: { credentialID: string; label?: string; location?: Location }) =>
        request(http, "PATCH", `/api/credential/${encodeURIComponent(params.credentialID)}`, {
          location: params.location,
          body: { label: params.label },
        }),
    },
  }
}
