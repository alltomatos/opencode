import { describe, expect, test } from "bun:test"
import { OpencodeCompat } from "../../src/session/llm/opencode-compat"

const nativeSession = "ses_0123456789abABCDEFGHIJKLMN"
const nativeRequest = "msg_0123456789abABCDEFGHIJKLMN"

function withEnv<A>(key: string, value: string | undefined, fn: () => A): A {
  const previous = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
}

describe("opencode-compat", () => {
  test("keeps ids that already use the native shape", () => {
    expect(OpencodeCompat.sessionId(nativeSession)).toBe(nativeSession)
    expect(OpencodeCompat.requestId(nativeRequest)).toBe(nativeRequest)
  })

  test("derives stable native ids from arbitrary values", () => {
    const first = OpencodeCompat.sessionId("session-1")
    const second = OpencodeCompat.sessionId("session-1")
    expect(second).toBe(first)
    expect(first).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(first).not.toBe(nativeSession)
  })

  test("derives distinct request ids with the msg prefix", () => {
    const request = OpencodeCompat.requestId("request-1")
    expect(request).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(request).not.toBe(OpencodeCompat.requestId("request-2"))
  })

  test("builds the native header set", () => {
    const headers = OpencodeCompat.headers({ sessionID: "session-1", requestID: "request-1", projectID: "prj_1" })
    expect(headers["x-opencode-project"]).toBe("prj_1")
    expect(headers["x-opencode-session"]).toBe(headers["x-opencode-session-id"])
    expect(headers["x-opencode-session"]).toBe(OpencodeCompat.sessionId("session-1"))
    expect(headers["x-opencode-request"]).toBe(OpencodeCompat.requestId("request-1"))
    expect(headers["x-opencode-client"]).toBe("cli")
    expect(headers["User-Agent"]).toStartWith("opencode/")
  })

  test("falls back to the global project", () => {
    const headers = OpencodeCompat.headers({ sessionID: "session-2", requestID: "request-2" })
    expect(headers["x-opencode-project"]).toBe("global")
  })

  test("reports the CLI version instead of the installation build", () => {
    withEnv("OPENCODE_FREE_USER_AGENT", undefined, () =>
      withEnv("OPENCODE_FREE_VERSION", undefined, () => {
        expect(OpencodeCompat.userAgent()).toBe("opencode/1.21.65")
      }),
    )
  })

  test("allows overriding the reported version", () => {
    withEnv("OPENCODE_FREE_USER_AGENT", undefined, () =>
      withEnv("OPENCODE_FREE_VERSION", "1.22.0", () => {
        expect(OpencodeCompat.userAgent()).toBe("opencode/1.22.0")
      }),
    )
  })

  test("allows overriding the full user agent for hotfixes", () => {
    withEnv("OPENCODE_FREE_USER_AGENT", "opencode/latest/2.0.26/cli", () => {
      expect(OpencodeCompat.userAgent()).toBe("opencode/latest/2.0.26/cli")
    })
  })
})

describe("opencode free tier retry", () => {
  async function call(status: number, body: string) {
    const seen: (string | null)[] = []
    const base = async (_input: unknown, init?: any) => {
      seen.push(new Headers(init?.headers).get("user-agent"))
      return new Response(body, { status })
    }
    const response = await OpencodeCompat.retryFetch(base)("https://opencode.ai/inference/openai/v1", {
      method: "POST",
      headers: new Headers({ "user-agent": "opencode/1.25.1", "x-opencode-client": "cli" }),
    })
    return { calls: seen.length, seen, response }
  }

  test("retries free-tier rejections with the fallback identity", async () => {
    const result = await call(403, '{"type":"error","error":{"type":"FreeTierError"}}')
    expect(result.calls).toBe(2)
    expect(result.seen[1]).toBe(OpencodeCompat.fallbackUserAgent())
    expect(result.response.status).toBe(403)
  })

  test("retries retired-client rejections", async () => {
    const result = await call(
      403,
      "This version of OpenCode Desktop no longer supports free models. Update to the latest version.",
    )
    expect(result.calls).toBe(2)
  })

  test("leaves unrelated errors untouched", async () => {
    const result = await call(403, '{"error":{"message":"forbidden by policy"}}')
    expect(result.calls).toBe(1)
  })

  test("does not retry successful responses", async () => {
    const result = await call(200, "ok")
    expect(result.calls).toBe(1)
  })
})
