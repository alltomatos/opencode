import { describe, expect, test } from "bun:test"
import { computeStats, formatDuration, formatMinutes, getCutoffTime, type StatsDateRange } from "./stats-controller"
import type { Session } from "@opencode-ai/sdk/v2/client"

const mockSession = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_1",
  slug: "ses_1",
  projectID: "proj_1",
  workspaceID: "ws_1",
  directory: "/path/to/my-project",
  title: "Test Session",
  version: "1",
  cost: 0.05,
  tokens: {
    input: 1000,
    output: 500,
    reasoning: 200,
    cache: { read: 300, write: 50 },
  },
  model: { providerID: "anthropic", id: "claude-3-7-sonnet" },
  agent: "build",
  time: {
    created: 1700000000000,
    updated: 1700000000000,
  },
  ...overrides,
})

describe("formatDuration", () => {
  test("formats seconds, minutes, hours, days correctly", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(45000)).toBe("45s")
    expect(formatDuration(125000)).toBe("2m 5s")
    expect(formatDuration(3600000)).toBe("1h")
    expect(formatDuration(3660000)).toBe("1h 1m")
    expect(formatDuration(21600000)).toBe("6h") // 6 hours
    expect(formatDuration(3619620000)).toBe("41d 21h") // 60327 minutes
  })

  test("formatMinutes formats total minutes", () => {
    expect(formatMinutes(3600000)).toBe("60 min")
    expect(formatMinutes(3619620000, "pt-BR")).toBe("60.327 min")
  })
})

describe("computeStats", () => {
  test("calculates total duration and longest session correctly", () => {
    const s1 = mockSession({
      id: "s1",
      title: "Short task",
      time: { created: 1000, updated: 61000 }, // 60s
    })
    const s2 = mockSession({
      id: "s2",
      title: "Long task",
      time: { created: 1000, updated: 21601000 }, // 6 hours = 21,600,000 ms
    })

    const res = computeStats([s1, s2], { range: "all" })
    expect(res.totalSessions).toBe(2)
    expect(res.totalDurationMs).toBe(21660000)
    expect(res.longestDurationMs).toBe(21600000)
    expect(res.longestSessionTitle).toBe("Long task")
    expect(res.recentSessions[0].durationFormatted).toBe("6h")
    expect(res.recentSessions[1].durationFormatted).toBe("1m")
  })

  test("handles empty session list", () => {
    const res = computeStats([], { range: "all" })
    expect(res.totalSessions).toBe(0)
    expect(res.totalTokens).toBe(0)
    expect(res.totalDurationMs).toBe(0)
    expect(res.longestDurationMs).toBe(0)
  })
})
