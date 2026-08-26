import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { KnownExternalAgent } from "./external-agent-registry"

const SKILL_NAME = "batuta-cli"

const SKILL_MD = `---
name: batuta-cli
description: Report progress back to the Batuta orchestrator while working under its supervision, or delegate to workers if running as the orchestrator itself.
---

This session is running under Batuta orchestration.

- As a WORKER: report progress and completion back to the orchestrator as instructed in the initial prompt.
- As an ORCHESTRATOR: if the environment variables \`BATUTA_SERVER_URL\` and \`BATUTA_ACTIVITY_ID\` are set, you are the orchestrator. You have no "task" tool here — delegate to a worker with:

  \`\`\`
  POST $BATUTA_SERVER_URL/batuta/$BATUTA_ACTIVITY_ID/delegate
  Content-Type: application/json

  {"label": "<worker label>", "prompt": "<the task for that worker>"}
  \`\`\`

  The response is \`{"output": "<worker's result>"}\` — the call blocks until the worker finishes, so there is no need to poll. The exact list of workers and the activity's goal were given to you in the first message of this session.
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
