import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { IntegrationRotation } from "@opencode-ai/core/integration/rotation"
import { Integration } from "@opencode-ai/core/integration"

const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gemini-3.1-pro-high": "gemini-pro-agent",
}

const ANTIGRAVITY_BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
]

const CLIENT_CONFIGS = {
  ide: {
    id: "884354919052-36trc1jjb3tguiac32ov6cod268c5blh.apps.googleusercontent.com",
    secret: "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",
    userAgent: "antigravity/ide/2.1.1 darwin/arm64",
  },
  cli: {
    id: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    secret: "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",
    userAgent: "antigravity/cli/1.1.5 (aidev_client; os_type=darwin; arch=arm64; auth_method=consumer)",
  },
}

// Google reports remaining quota as a 0-1 fraction per bucket; we bench an
// account 5 points before it actually hits 100% so an in-flight request
// doesn't race the last sliver of quota and come back as a real 429.
const QUOTA_BENCH_THRESHOLD = 0.05
// retrieveUserQuota is called on (roughly) every chat message via
// getLiveToken, so it needs a short TTL cache to avoid doubling Google API
// traffic per message; quota doesn't change fast enough for 60-120s of
// staleness to matter here.
const QUOTA_CHECK_TTL_MS = 90_000
const quotaLastCheckedAt = new Map<string, number>()

let DatabaseConstructor: any

async function getDb(dbFile: string) {
  if (DatabaseConstructor) return new DatabaseConstructor(dbFile)
  if (typeof (process.versions as any).bun !== "undefined") {
    const mod = await import("bun:sqlite")
    DatabaseConstructor = class BunDbWrapper {
      db: any
      constructor(file: string) {
        this.db = new mod.Database(file)
      }
      prepare(sql: string) {
        const query = this.db.query(sql)
        return {
          all: (...args: any[]) => query.all(...args),
          run: (...args: any[]) => query.run(...args),
        }
      }
    }
  } else {
    const mod = await import("node:sqlite")
    DatabaseConstructor = mod.DatabaseSync
  }
  return new DatabaseConstructor(dbFile)
}

function toConnection(connectionId: string) {
  return { type: "credential" as const, id: connectionId as any, label: connectionId }
}

/** Parses a Google resetTime (epoch seconds/millis or ISO string) into epoch ms. */
function parseResetTimeMs(resetValue: unknown): number | null {
  try {
    if (typeof resetValue === "number") return resetValue < 1e12 ? resetValue * 1000 : resetValue
    if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const ts = Number(resetValue)
        return ts < 1e12 ? ts * 1000 : ts
      }
      const parsed = Date.parse(resetValue)
      return Number.isNaN(parsed) ? null : parsed
    }
  } catch {}
  return null
}

/**
 * Proactively checks a connection's Google-reported quota and benches it
 * (via IntegrationRotation) if any bucket is at or below the threshold, so
 * `pick()` routes around it before it hits a real 429. Fails open: any
 * network/parse error, or Google simply not reporting `remainingFraction`
 * for a bucket, is treated as "unknown" and never benches the account.
 */
async function checkQuotaAndBenchIfLow(
  profile: "ide" | "cli",
  connectionId: string,
  token: string,
  projectID: string,
): Promise<void> {
  if (!token) return
  const lastChecked = quotaLastCheckedAt.get(connectionId)
  if (lastChecked !== undefined && Date.now() - lastChecked < QUOTA_CHECK_TTL_MS) return
  quotaLastCheckedAt.set(connectionId, Date.now())

  try {
    const client = CLIENT_CONFIGS[profile]
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      Authorization: `Bearer ${token}`,
    }

    let data: any
    for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
      try {
        const res = await fetch(`${baseUrl}/v1internal:retrieveUserQuota`, {
          method: "POST",
          headers,
          body: JSON.stringify({ project: projectID }),
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) continue
        data = await res.json()
        break
      } catch {
        continue
      }
    }
    if (!data || !Array.isArray(data.buckets)) return

    for (const bucket of data.buckets) {
      const rawFraction = bucket?.remainingFraction
      // Field absent (fractionReported=false in OmniRoute's terms) means
      // Google didn't report this bucket's usage, not that it's at 0%.
      if (typeof rawFraction !== "number") continue
      if (rawFraction > QUOTA_BENCH_THRESHOLD) continue

      const resetAtMs = parseResetTimeMs(bucket?.resetTime)
      const durationMs = resetAtMs && resetAtMs > Date.now() ? resetAtMs - Date.now() : 15 * 60_000
      IntegrationRotation.markUnavailable(toConnection(connectionId), durationMs)
      return
    }
  } catch {
    // Fail open — a broken quota probe must never bench an otherwise-healthy account.
  }
}

async function refreshAccountToken(
  connectionId: string,
  profile: "ide" | "cli",
): Promise<{ token?: string; projectID?: string; error?: string }> {
  try {
    const dbFile = CoreDatabase.path()
    const db = await getDb(dbFile)
    const row = db.prepare("SELECT value FROM credential WHERE id = ?").get(connectionId) as { value: string } | undefined
    if (!row) return { error: "Credential not found" }

    const parsed = JSON.parse(row.value)
    if (!parsed.refresh) return { error: "No refresh token available" }

    const client = CLIENT_CONFIGS[profile]
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: parsed.refresh,
      client_id: client.id,
      client_secret: client.secret,
    })

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      return { error: errText || `Refresh failed with status ${res.status}` }
    }

    const refreshed = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    parsed.access = refreshed.access_token
    if (typeof refreshed.refresh_token === "string" && refreshed.refresh_token) {
      parsed.refresh = refreshed.refresh_token
    }
    parsed.expires = Date.now() + refreshed.expires_in * 1000

    db.prepare("UPDATE credential SET value = ?, time_updated = ? WHERE id = ?").run(
      JSON.stringify(parsed),
      Date.now(),
      connectionId,
    )

    return { token: refreshed.access_token, projectID: parsed.metadata?.projectID || "aicode-consumers" }
  } catch (err) {
    return { error: String(err) }
  }
}

async function getLiveToken(
  integrationID: string,
  profile: "ide" | "cli",
): Promise<{ token: string; projectID: string; connectionId?: string; exhausted?: boolean }> {
  try {
    const dbFile = CoreDatabase.path()
    const db = await getDb(dbFile)
    const rawRows = db
      .prepare("SELECT id, label, value, time_updated, time_created FROM credential WHERE integration_id = ? ORDER BY time_updated DESC, time_created DESC")
      .all(integrationID) as { id: string; label: string; value: string; time_updated?: number; time_created?: number }[]
    if (!rawRows.length) return { token: "", projectID: "aicode-consumers" }

    // Deduplicate in memory by email / label
    const seen = new Set<string>()
    const rows: { id: string; value: string }[] = []
    for (const r of rawRows) {
      try {
        const p = JSON.parse(r.value)
        const email = p?.metadata?.email || r.label
        if (email && seen.has(email)) continue
        if (email) seen.add(email)
        rows.push({ id: r.id, value: r.value })
      } catch {
        rows.push({ id: r.id, value: r.value })
      }
    }

    // Convert rows to IntegrationConnection format for rotation picker
    const connections = rows.map((r) => ({
      type: "credential" as const,
      id: r.id as any,
      label: r.id,
    }))

    if (connections.every((c) => !IntegrationRotation.isAvailable(c))) {
      return { token: "", projectID: "aicode-consumers", exhausted: true }
    }

    const availableConnections = connections.filter((c) => IntegrationRotation.isAvailable(c))
    const picked = IntegrationRotation.pick(Integration.ID.make(integrationID), availableConnections)
    const selectedId = picked?.type === "credential" ? picked.id : availableConnections[0]?.id
    const selectedRow = rows.find((r) => r.id === selectedId) ?? rows[0]

    const parsed = JSON.parse(selectedRow.value)
    const now = Date.now()
    let access = parsed.access as string
    const projectID = parsed.metadata?.projectID || "aicode-consumers"

    // If token expires in less than 5 minutes (or expired/missing expiry), refresh proactively
    if (parsed.refresh && (!parsed.expires || parsed.expires - now < 300_000)) {
      const refreshed = await refreshAccountToken(selectedRow.id, profile)
      if (refreshed.token) {
        access = refreshed.token
      }
    }

    await checkQuotaAndBenchIfLow(profile, selectedRow.id, access, projectID)

    return { token: access, projectID, connectionId: selectedRow.id }
  } catch {
    return { token: "", projectID: "aicode-consumers" }
  }
}

function transformSseStream(readable: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = readable.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) {
            controller.enqueue(encoder.encode("\n"))
            continue
          }
          if (trimmed.startsWith("data: ")) {
            const dataContent = trimmed.slice(6).trim()
            if (dataContent === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              continue
            }
            try {
              const parsed = JSON.parse(dataContent)
              const unwrapped = parsed.response ?? (Array.isArray(parsed) ? parsed[0]?.response : undefined) ?? parsed
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(unwrapped)}\n\n`))
            } catch {
              controller.enqueue(encoder.encode(`${line}\n`))
            }
          } else {
            controller.enqueue(encoder.encode(`${line}\n`))
          }
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Reacts to a real failure response from Google (429, or a Code Assist
 * error body with `status: "RESOURCE_EXHAUSTED"`) by benching the
 * connection that made the request, reusing rotation.ts's own
 * classification instead of re-deriving cooldown durations here. This
 * covers the gap where quota gets consumed between our proactive check in
 * `checkQuotaAndBenchIfLow` and the actual request landing.
 */
function benchConnectionOnFailure(connectionId: string, status: number, bodyText: string): void {
  let googleStatus: string | undefined
  try {
    googleStatus = JSON.parse(bodyText)?.error?.status
  } catch {}

  // A bare HTTP status maps to isBenchableFailure's 429/rate-limit branch
  // (5 min default). Tagging RESOURCE_EXHAUSTED explicitly routes it to
  // the QuotaExceeded branch instead (15 min default) rather than letting
  // an incidental 429 status code shadow it.
  const errorLike: any =
    googleStatus === "RESOURCE_EXHAUSTED" ? { _tag: "QuotaExceeded" } : { status, message: bodyText }

  const check = IntegrationRotation.isBenchableFailure(errorLike)
  if (check.bench) IntegrationRotation.markUnavailable(toConnection(connectionId), check.durationMs)
}

export interface QuotaBucketInfo {
  modelId: string
  remainingFraction: number
  remainingPercentage: number
  resetTime: string | null
}

export interface UserQuotaDetails {
  email?: string
  tier: "pro" | "free" | "unknown"
  buckets: QuotaBucketInfo[]
  overallPercentage: number
}

export async function fetchUserQuotaDetails(
  credentialID: string,
  profile: "ide" | "cli" = "cli",
): Promise<UserQuotaDetails | null> {
  try {
    const dbFile = CoreDatabase.path()
    const db = await getDb(dbFile)
    const row = db.prepare("SELECT value FROM credential WHERE id = ?").get(credentialID) as
      | { value: string }
      | undefined
    if (!row) return null

    const parsed = JSON.parse(row.value)
    const now = Date.now()
    let access = parsed.access as string
    const projectID = parsed.metadata?.projectID || "aicode-consumers"

    // Proactively refresh if needed
    if (parsed.refresh && (!parsed.expires || parsed.expires - now < 300_000)) {
      const client = CLIENT_CONFIGS[profile]
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: parsed.refresh,
        client_id: client.id,
        client_secret: client.secret,
      })
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      })
      if (res.ok) {
        const refreshed = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
        access = refreshed.access_token
        parsed.access = access
        if (typeof refreshed.refresh_token === "string" && refreshed.refresh_token) {
          parsed.refresh = refreshed.refresh_token
        }
        parsed.expires = Date.now() + refreshed.expires_in * 1000
        db.prepare("UPDATE credential SET value = ?, time_updated = ? WHERE id = ?").run(
          JSON.stringify(parsed),
          Date.now(),
          credentialID,
        )
      }
    }

    if (!access) return null

    const client = CLIENT_CONFIGS[profile]
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      Authorization: `Bearer ${access}`,
    }

    let data: any
    for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
      try {
        let res = await fetch(`${baseUrl}/v1internal:retrieveUserQuota`, {
          method: "POST",
          headers,
          body: JSON.stringify({ project: projectID }),
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          res = await fetch(`${baseUrl}/v1internal:retrieveUserQuota`, {
            method: "POST",
            headers,
            body: "{}",
            signal: AbortSignal.timeout(8000),
          })
        }
        if (!res.ok) continue
        data = await res.json()
        break
      } catch {
        continue
      }
    }

    if (!data) {
      return {
        email: parsed.metadata?.email,
        tier: "free",
        buckets: [],
        overallPercentage: 100,
      }
    }

    const FREE_MODELS_DEFAULT = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash-thinking",
      "gemini-3-flash",
      "gemini-3.1-flash-lite",
    ]

    const buckets: QuotaBucketInfo[] = []
    let totalFraction = 0
    let validCount = 0

    if (Array.isArray(data.buckets) && data.buckets.length > 0) {
      for (const bucket of data.buckets) {
        const raw = bucket?.remainingFraction
        const fraction = typeof raw === "number" ? Math.max(0, Math.min(1, raw)) : 1
        const pct = Math.round(fraction * 100)
        buckets.push({
          modelId: bucket?.modelId || bucket?.id || "default",
          remainingFraction: fraction,
          remainingPercentage: pct,
          resetTime: bucket?.resetTime || null,
        })
        if (typeof raw === "number") {
          totalFraction += fraction
          validCount++
        }
      }
    } else {
      // Free tier accounts that do not return explicit buckets array in retrieveUserQuota
      for (const model of FREE_MODELS_DEFAULT) {
        buckets.push({
          modelId: model,
          remainingFraction: 1,
          remainingPercentage: 100,
          resetTime: null,
        })
      }
      validCount = FREE_MODELS_DEFAULT.length
      totalFraction = FREE_MODELS_DEFAULT.length
    }

    const avgFraction = validCount > 0 ? totalFraction / validCount : 1
    // Detect Pro tier: Pro accounts usually have more than 5 model buckets (including pro models like gemini-3.1-pro-high)
    const isPro = data.userTier === "PRO" || data.tier === "pro" || Boolean(data.isProUser) || (Array.isArray(data.buckets) && data.buckets.some((b: any) => b?.modelId?.includes("pro") || b?.modelId?.includes("3.1-pro") || b?.modelId?.includes("3.7-flash")))

    return {
      email: parsed.metadata?.email,
      tier: isPro ? "pro" : "free",
      buckets,
      overallPercentage: Math.round(avgFraction * 100),
    }
  } catch {
    return {
      tier: "free",
      buckets: [],
      overallPercentage: 100,
    }
  }
}

export function createAntigravityFetch(profile: "ide" | "cli", getOptions?: () => Record<string, any>) {
  const integrationID = profile === "cli" ? "google-antigravity-cli" : "google-antigravity"
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!urlStr.includes("GenerateContent") && !urlStr.includes("generateContent")) {
      return fetch(input, init)
    }

    const opts = getOptions?.() ?? {}
    let token = opts["accessToken"] ?? opts["apiKey"]
    let projectID = opts["projectID"]
    let usedConnectionId: string | undefined

    if (!token || token === "antigravity-oauth" || !projectID) {
      const live = await getLiveToken(integrationID, profile)
      if (live.exhausted) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "Todas as contas AGY atingiram o limite de cota; aguarde o reset.",
            },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        )
      }
      if (live.token) token = live.token
      if (!projectID) projectID = live.projectID
      usedConnectionId = live.connectionId
    }

    const modelMatch = urlStr.match(/\/models\/([^:]+):/)
    const rawModel = modelMatch ? modelMatch[1] : "gemini-pro-agent"
    const model = MODEL_ALIASES[rawModel] ?? rawModel

    const reqBody = typeof init?.body === "string" ? JSON.parse(init.body) : {}

    if (rawModel.includes("-high")) {
      reqBody.generationConfig = reqBody.generationConfig ?? {}
      reqBody.generationConfig.thinkingConfig = { thinkingBudget: 24576 }
    } else if (rawModel.includes("-medium")) {
      reqBody.generationConfig = reqBody.generationConfig ?? {}
      reqBody.generationConfig.thinkingConfig = { thinkingBudget: 8192 }
    } else if (rawModel.includes("-low")) {
      reqBody.generationConfig = reqBody.generationConfig ?? {}
      reqBody.generationConfig.thinkingConfig = { thinkingBudget: 1024 }
    }

    const envelope = {
      project: projectID ?? "aicode-consumers",
      model,
      request: reqBody,
    }

    const client = CLIENT_CONFIGS[profile]
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const executeGenerate = async (
      authToken: string,
      pId: string,
    ): Promise<Response | undefined> => {
      const currentHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      }
      const currentEnvelope = {
        project: pId ?? "aicode-consumers",
        model,
        request: reqBody,
      }

      let res: Response | undefined
      for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
        try {
          const r = await fetch(`${baseUrl}/v1internal:streamGenerateContent?alt=sse`, {
            method: "POST",
            headers: currentHeaders,
            body: JSON.stringify(currentEnvelope),
            signal: init?.signal,
          })
          res = r
          if (r.ok) break
        } catch (e) {
          if (!res) res = new Response(String(e), { status: 500 })
        }
      }
      return res
    }

    let upstream = await executeGenerate(token, projectID)

    // Handle 401 / UNAUTHENTICATED / Token expiration with automatic refresh and failover
    if (upstream && !upstream.ok && (upstream.status === 401 || upstream.status === 403)) {
      const bodyText = await upstream
        .clone()
        .text()
        .catch(() => "")
      const isAuthIssue =
        upstream.status === 401 ||
        bodyText.includes("UNAUTHENTICATED") ||
        bodyText.includes("Verify your account") ||
        bodyText.includes("invalid_grant") ||
        bodyText.includes("ACCESS_TOKEN_EXPIRED")

      if (isAuthIssue && usedConnectionId) {
        // 1. Try immediate token refresh
        const refreshed = await refreshAccountToken(usedConnectionId, profile)
        if (refreshed.token) {
          token = refreshed.token
          projectID = refreshed.projectID || projectID
          upstream = await executeGenerate(token, projectID)
        } else {
          // 2. Refresh failed or account requires verification -> bench account & try failover to next account
          IntegrationRotation.markUnavailable(toConnection(usedConnectionId), 15 * 60_000)
          const nextLive = await getLiveToken(integrationID, profile)
          if (nextLive.token && nextLive.connectionId !== usedConnectionId) {
            token = nextLive.token
            projectID = nextLive.projectID
            usedConnectionId = nextLive.connectionId
            upstream = await executeGenerate(token, projectID)
          }
        }
      }
    }

    if (!upstream || !upstream.ok) {
      if (usedConnectionId && upstream) {
        const bodyText = await upstream
          .clone()
          .text()
          .catch(() => "")
        benchConnectionOnFailure(usedConnectionId, upstream.status, bodyText)
      }
      return upstream ?? new Response("Antigravity API Unavailable", { status: 502 })
    }

    if (!upstream.body) {
      return upstream
    }

    // If client requested non-streaming generateContent (e.g. title generation / doGenerate)
    if (!urlStr.includes("alt=sse")) {
      const text = await upstream.text()
      // Unwrap SSE chunks into single JSON response for SDK
      let unwrapped: any = { candidates: [] }
      const lines = text.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataContent = line.slice(6).trim()
          if (dataContent && dataContent !== "[DONE]") {
            try {
              const parsed = JSON.parse(dataContent)
              const chunkCandidates = parsed.response?.candidates ?? parsed.candidates
              if (Array.isArray(chunkCandidates)) {
                unwrapped.candidates.push(...chunkCandidates)
              }
            } catch {}
          }
        }
      }
      return new Response(JSON.stringify(unwrapped), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    const transformed = transformSseStream(upstream.body)
    return new Response(transformed, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }
}
