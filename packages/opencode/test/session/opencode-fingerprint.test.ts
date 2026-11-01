import { describe, expect, test } from "bun:test"
import { jsonSchema, tool } from "ai"
import { OpencodeFingerprint } from "../../src/session/llm/opencode-fingerprint"

describe("opencode-fingerprint", () => {
  test("ships the native tool quartet", () => {
    const tools = OpencodeFingerprint.tools()
    expect(Object.keys(tools).sort()).toStrictEqual(["bash", "edit", "read", "write"])
    for (const item of Object.values(tools)) {
      expect(item.description?.length).toBeGreaterThan(0)
      expect(item.inputSchema).toBeDefined()
    }
  })

  test("augments without replacing caller tools", () => {
    const caller = tool({ description: "caller", inputSchema: jsonSchema({ type: "object" }) })
    const tools = OpencodeFingerprint.augment({ bash: caller })
    expect(tools.bash).toBe(caller)
    expect(Object.keys(tools).sort()).toStrictEqual(["bash", "edit", "read", "write"])
  })

  test("leaves a complete tool set untouched", () => {
    const existing = OpencodeFingerprint.tools()
    expect(OpencodeFingerprint.augment(existing)).toBe(existing)
  })

  test("detects free models by suffix or zero input cost", () => {
    expect(OpencodeFingerprint.isFree({ id: "deepseek-v4.1-flash-free", cost: { input: 1 } })).toBe(true)
    expect(OpencodeFingerprint.isFree({ id: "deepseek-v4.1-flash", cost: { input: 0 } })).toBe(true)
    expect(OpencodeFingerprint.isFree({ id: "deepseek-v4.1-flash", cost: { input: 1 } })).toBe(false)
    expect(OpencodeFingerprint.isFree({ id: "deepseek-v4.1-flash", cost: undefined })).toBe(false)
  })
})
