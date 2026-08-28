import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installBatutaCliSkill, removeBatutaCliSkill } from "@opencode-ai/core/external-agent-skill"

const agent = { id: "claude", name: "Claude Code", bin: "claude", skillsDir: ".claude/skills" }

describe("installBatutaCliSkill", () => {
  test("writes SKILL.md under <home>/<skillsDir>/batuta-cli/", async () => {
    const home = await mkdtemp(join(tmpdir(), "external-agent-skill-"))

    await installBatutaCliSkill(agent, home)

    const content = await readFile(join(home, ".claude", "skills", "batuta-cli", "SKILL.md"), "utf8")
    expect(content.length).toBeGreaterThan(0)
    expect(content).toContain("batuta-cli")
  })

  test("is idempotent when called twice", async () => {
    const home = await mkdtemp(join(tmpdir(), "external-agent-skill-"))

    await installBatutaCliSkill(agent, home)
    await installBatutaCliSkill(agent, home)

    const content = await readFile(join(home, ".claude", "skills", "batuta-cli", "SKILL.md"), "utf8")
    expect(content.length).toBeGreaterThan(0)
  })
})

describe("removeBatutaCliSkill", () => {
  test("removes the skill directory after install", async () => {
    const home = await mkdtemp(join(tmpdir(), "external-agent-skill-"))
    await installBatutaCliSkill(agent, home)

    await removeBatutaCliSkill(agent, home)

    await expect(stat(join(home, ".claude", "skills", "batuta-cli"))).rejects.toThrow()
  })

  test("is a no-op when the skill was never installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "external-agent-skill-"))

    await expect(removeBatutaCliSkill(agent, home)).resolves.toBeUndefined()
  })
})
