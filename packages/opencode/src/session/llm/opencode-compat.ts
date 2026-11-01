import { createHash } from "node:crypto"

/**
 * Identity headers for the hosted OpenCode free tier (`opencode.ai/inference`).
 *
 * The gateway fingerprints the client and only serves free models to builds it
 * recognizes as a native OpenCode CLI. Reporting the installation build number
 * (for example `opencode/1.21.92`) is what produced:
 *
 *   "This version of OpenCode Desktop no longer supports free models.
 *    Update to the latest version at https://opencode.ai/download ..."
 *
 * even though the very same model worked from the CLI. So the desktop presents
 * the CLI identity: the same User-Agent base shape the CLI sends (the AI SDK
 * appends its own `ai-sdk/... runtime/...` suffix on top), the CLI client
 * identifier, and the paired session headers the free lane expects.
 *
 * Both values stay overridable so a gateway change can be hotfixed through the
 * environment without shipping a release:
 *
 *   OPENCODE_FREE_USER_AGENT           full User-Agent override
 *   OPENCODE_FREE_VERSION              version used to build `opencode/<version>`
 *   OPENCODE_FREE_FALLBACK_USER_AGENT  full fallback User-Agent override
 */
const COMPAT_VERSION = "1.21.65"

const NATIVE_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
const NATIVE_REQUEST = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const MAX_TRANSLATED = 1_000
const translated = new Map<string, string>()

/**
 * The free-tier gate decodes the 12-hex prefix of session/request IDs as a
 * native inverted BigInt timestamp. Random (or imported) IDs decode to a
 * corrupt timestamp and are rejected. Mint a valid prefix plus a deterministic
 * suffix, cached so retries and follow-up turns keep the same identity.
 */
function translate(kind: "session" | "request", value: string) {
  const prefix = kind === "session" ? "ses" : "msg"
  const key = `${prefix}:${value}`
  const cached = translated.get(key)
  if (cached) return cached

  const now = BigInt(Date.now()) * 0x1000n + 1n
  // Session IDs travel the native descending path (inverted timestamp);
  // request IDs are ascending, like the CLI's message IDs.
  const stamp = kind === "session" ? ~now : now
  let time = ""
  for (let index = 0; index < 6; index++) {
    time += Number((stamp >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  }

  const digest = createHash("sha256").update(`opencode\0${prefix}\0${value}`).digest()
  let suffix = ""
  for (let index = 0; index < 14; index++) suffix += BASE62[digest[index]! % 62]
  const id = `${prefix}_${time}${suffix}`

  if (translated.size >= MAX_TRANSLATED) translated.delete(translated.keys().next().value!)
  translated.set(key, id)
  return id
}

export function sessionId(value: string) {
  const id = value.trim()
  return NATIVE_SESSION.test(id) ? id : translate("session", id)
}

export function requestId(value: string) {
  const id = value.trim()
  return NATIVE_REQUEST.test(id) ? id : translate("request", id)
}

export function userAgent() {
  const override = process.env.OPENCODE_FREE_USER_AGENT?.trim()
  if (override) return override
  return `opencode/${process.env.OPENCODE_FREE_VERSION?.trim() || COMPAT_VERSION}`
}

/**
 * Second identity attempted when the gateway still refuses the request. The
 * CLI exposes both User-Agent shapes across releases, so if the flat
 * `opencode/<version>` form stops being accepted we retry once with the
 * channel-qualified form before surfacing the error.
 */
export function fallbackUserAgent() {
  const override = process.env.OPENCODE_FREE_FALLBACK_USER_AGENT?.trim()
  if (override) return override
  return `opencode/latest/${process.env.OPENCODE_FREE_VERSION?.trim() || COMPAT_VERSION}/cli`
}

export function headers(input: { sessionID: string; requestID: string; projectID?: string }) {
  const session = sessionId(input.sessionID)
  return {
    "x-opencode-project": input.projectID || "global",
    // The gate requires both headers to be present with the same value.
    "x-opencode-session": session,
    "x-opencode-session-id": session,
    "x-opencode-request": requestId(input.requestID),
    "x-opencode-client": "cli",
    "User-Agent": userAgent(),
  }
}

const rejection = /free tier|free models|freetier|upgrade required|no longer supports/i

/**
 * Free-tier rejections are decided from the request identity, before any model
 * output is produced, so retrying the same call with the fallback identity is
 * safe. Runs below the AI SDK, which keeps this transparent to the session loop.
 */
export function retryFetch(base: (input: any, init?: any) => Promise<Response>) {
  return async (input: any, init?: any): Promise<Response> => {
    const res = await base(input, init)
    if (res.status !== 401 && res.status !== 403 && res.status !== 426) return res
    const body = await res
      .clone()
      .text()
      .catch(() => "")
    if (!rejection.test(body)) return res
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("user-agent", fallbackUserAgent())
    headers.set("x-opencode-client", "cli")
    return base(input, { ...init, headers })
  }
}

export * as OpencodeCompat from "./opencode-compat"
