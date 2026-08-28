import { access, constants } from "node:fs/promises"
import { join } from "node:path"
import { KNOWN_EXTERNAL_AGENTS, type KnownExternalAgent } from "./external-agent-registry"

export type DetectedExternalAgent = {
  readonly id: string
  readonly installed: boolean
}

// Detection never spawns a subprocess (no `which`/`where`) — some security software
// intercepts spawns and hangs. We only stat candidate paths on the PATH directories.
function candidateNames(bin: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [bin]
  return [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin]
}

async function isOnPath(bin: string, pathDirs: readonly string[], platform: NodeJS.Platform): Promise<boolean> {
  for (const dir of pathDirs) {
    for (const name of candidateNames(bin, platform)) {
      try {
        await access(join(dir, name), constants.F_OK)
        return true
      } catch {}
    }
  }
  return false
}

export async function detectExternalAgents(options?: {
  env?: Partial<Pick<NodeJS.ProcessEnv, "PATH" | "Path">>
  platform?: NodeJS.Platform
  agents?: readonly KnownExternalAgent[]
}): Promise<DetectedExternalAgent[]> {
  const env = options?.env ?? process.env
  const platform = options?.platform ?? process.platform
  const agents = options?.agents ?? KNOWN_EXTERNAL_AGENTS
  const raw = env.PATH ?? env.Path ?? ""
  const dirs = raw.split(platform === "win32" ? ";" : ":").filter(Boolean)

  const results: DetectedExternalAgent[] = []
  for (const agent of agents) {
    results.push({ id: agent.id, installed: await isOnPath(agent.bin, dirs, platform) })
  }
  return results
}
