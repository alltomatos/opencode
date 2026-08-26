import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { KnownExternalAgent } from "./external-agent-registry"

const SKILL_NAME = "batuta-cli"

const SKILL_MD = `---
name: batuta-cli
description: Report progress back to the Batuta orchestrator while working under its supervision.
---

This session is running as a worker under Batuta orchestration. Report progress
and completion back to the orchestrator as instructed in the initial prompt.
`

function skillDir(agent: Pick<KnownExternalAgent, "skillsDir">, home: string): string {
  return join(home, agent.skillsDir, SKILL_NAME)
}

export async function installBatutaCliSkill(
  agent: Pick<KnownExternalAgent, "skillsDir">,
  home: string,
): Promise<void> {
  const dir = skillDir(agent, home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "SKILL.md"), SKILL_MD, "utf8")
}

export async function removeBatutaCliSkill(
  agent: Pick<KnownExternalAgent, "skillsDir">,
  home: string,
): Promise<void> {
  await rm(skillDir(agent, home), { recursive: true, force: true })
}
