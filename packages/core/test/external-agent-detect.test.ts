import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectExternalAgents } from "@opencode-ai/core/external-agent-detect"

const agents = [
  { id: "claude", name: "Claude Code", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
]

describe("detectExternalAgents", () => {
  test("marks an agent as installed when its binary is on the PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "external-agent-detect-"))
    await writeFile(join(dir, "claude"), "#!/bin/sh\n")

    const result = await detectExternalAgents({ env: { PATH: dir }, agents })

    expect(result).toEqual([
      { id: "claude", installed: true },
      { id: "codex", installed: false },
    ])
  })

  test("checks Windows executable extensions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "external-agent-detect-win-"))
    await writeFile(join(dir, "codex.cmd"), "@echo off\n")

    const result = await detectExternalAgents({ env: { PATH: dir }, platform: "win32", agents })

    expect(result).toEqual([
      { id: "claude", installed: false },
      { id: "codex", installed: true },
    ])
  })

  test("returns every agent as not installed when the PATH is empty", async () => {
    const result = await detectExternalAgents({ env: { PATH: "" }, agents })

    expect(result).toEqual([
      { id: "claude", installed: false },
      { id: "codex", installed: false },
    ])
  })

  test("returns one entry per known agent, in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "external-agent-detect-order-"))
    await mkdir(dir, { recursive: true })

    const result = await detectExternalAgents({ env: { PATH: dir }, agents })

    expect(result.map((r) => r.id)).toEqual(["claude", "codex"])
  })
})
