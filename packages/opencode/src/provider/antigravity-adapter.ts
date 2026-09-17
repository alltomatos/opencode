const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gemini-3.1-pro-high": "gemini-pro-agent",
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
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!urlStr.includes("streamGenerateContent")) {
      return fetch(input, init)
    }

    const opts = getOptions?.() ?? {}
    const token = opts["accessToken"] ?? opts["apiKey"]
    const projectID = opts["projectID"] ?? "aicode-consumers"

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
      project: projectID,
      model,
      request: reqBody,
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": profile === "cli" ? "antigravity/cli" : "antigravity/ide",
    }
    if (token && token !== "antigravity-oauth") {
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
