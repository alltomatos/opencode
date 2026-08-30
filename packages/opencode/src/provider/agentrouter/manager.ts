import path from "path"
import { Process } from "@/util/process"

const DEFAULT_PORT = 7187
const RELAY_SCRIPT = path.join(import.meta.dirname, "relay.py")

export class AgentRouterRelayError extends Error {}

interface RelayHandle {
  baseURL: string
}

// Dedup within this opencode process — the provider loader can run more than
// once (e.g. re-init), so don't spawn a second relay while one is starting.
let starting: Promise<RelayHandle> | undefined

export function ensureRelay(apiKey: string, port = DEFAULT_PORT): Promise<RelayHandle> {
  if (!starting) {
    starting = start(apiKey, port).catch((err) => {
      starting = undefined
      throw err
    })
  }
  return starting
}

async function healthy(baseURL: string, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

async function findPython(): Promise<string> {
  for (const bin of ["python3", "python"]) {
    const out = await Process.run([bin, "--version"], { nothrow: true })
    if (out.code === 0) return bin
  }
  throw new AgentRouterRelayError(
    "AgentRouter relay requires Python 3.9+ on PATH (checked `python3` and `python`), but none was found. Install Python to use the AgentRouter provider.",
  )
}

async function ensureAnthropicPackage(python: string): Promise<void> {
  const check = await Process.run([python, "-c", "import anthropic"], { nothrow: true })
  if (check.code === 0) return
  const install = await Process.run([python, "-m", "pip", "install", "--quiet", "anthropic"], { nothrow: true })
  if (install.code !== 0) {
    throw new AgentRouterRelayError(
      `Failed to install the Python "anthropic" package needed by the AgentRouter relay:\n${install.stderr.toString().trim()}`,
    )
  }
}

async function start(apiKey: string, port: number): Promise<RelayHandle> {
  const baseURL = `http://127.0.0.1:${port}`

  if (await healthy(baseURL)) return { baseURL }

  const python = await findPython()
  await ensureAnthropicPackage(python)

  const child = Process.spawn([python, RELAY_SCRIPT], {
    env: { AGENTROUTER_API_KEY: apiKey, AGENTROUTER_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  })

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  child.exited.then((code) => {
    if (code !== 0) starting = undefined
  })

  for (let attempt = 0; attempt < 20; attempt++) {
    if (child.exitCode !== null) {
      throw new AgentRouterRelayError(`AgentRouter relay exited early (code ${child.exitCode}):\n${stderr.trim()}`)
    }
    if (await healthy(baseURL, 500)) return { baseURL }
    await new Promise((r) => setTimeout(r, 500))
  }

  await Process.stop(child)
  throw new AgentRouterRelayError(`AgentRouter relay did not become healthy in time:\n${stderr.trim()}`)
}
