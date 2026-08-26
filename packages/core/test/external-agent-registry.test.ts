import { describe, expect, test } from "bun:test"
import { KNOWN_EXTERNAL_AGENTS } from "@opencode-ai/core/external-agent-registry"

describe("KNOWN_EXTERNAL_AGENTS", () => {
  test("has no duplicate id", () => {
    const ids = KNOWN_EXTERNAL_AGENTS.map((agent) => agent.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("includes claude and codex", () => {
    const ids = KNOWN_EXTERNAL_AGENTS.map((agent) => agent.id)
    expect(ids).toContain("claude")
    expect(ids).toContain("codex")
  })

  test("every entry has a non-empty binary name", () => {
    for (const agent of KNOWN_EXTERNAL_AGENTS) {
      expect(agent.bin.length).toBeGreaterThan(0)
    }
  })
})
