import { Database } from "bun:sqlite"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"

const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gemini-3.1-pro-high": "gemini-pro-agent",
}

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

async function getLiveToken(integrationID: string, profile: "ide" | "cli"): Promise<{ token: string; projectID: string }> {
  try {
    const dbFile = CoreDatabase.path()
    const db = new Database(dbFile)
    const rows = db
      .query("SELECT id, value FROM credential WHERE integration_id = ? ORDER BY time_updated DESC LIMIT 1")
      .all(integrationID) as { id: string; value: string }[]
    if (!rows.length) return { token: "", projectID: "aicode-consumers" }

    const parsed = JSON.parse(rows[0].value)
    const now = Date.now()
    let access = parsed.access as string
    const projectID = parsed.metadata?.projectID || "aicode-consumers"

    // If token expires in less than 2 minutes, refresh proactively
    if (parsed.refresh && (!parsed.expires || parsed.expires - now < 120_000)) {
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
        const refreshed = (await res.json()) as { access_token: string; expires_in: number }
        access = refreshed.access_token
        parsed.access = access
        parsed.expires = Date.now() + refreshed.expires_in * 1000
        db.query("UPDATE credential SET value = ?, time_updated = ? WHERE id = ?").run(
          JSON.stringify(parsed),
          Date.now(),
          rows[0].id,
        )
      }
    }

    return { token: access, projectID }
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

export function createAntigravityFetch(profile: "ide" | "cli", getOptions?: () => Record<string, any>) {
  const integrationID = profile === "cli" ? "google-antigravity-cli" : "google-antigravity"
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!urlStr.includes("streamGenerateContent")) {
      return fetch(input, init)
    }

    const opts = getOptions?.() ?? {}
    let token = opts["accessToken"] ?? opts["apiKey"]
    let projectID = opts["projectID"]

    if (!token || token === "antigravity-oauth" || !projectID) {
      const live = await getLiveToken(integrationID, profile)
      if (live.token) token = live.token
      if (!projectID) projectID = live.projectID
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

    const upstream = await fetch("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse", {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
      signal: init?.signal,
    })

    if (!upstream.ok || !upstream.body) {
      return upstream
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
