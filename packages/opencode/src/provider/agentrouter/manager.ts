import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Process } from "@/util/process"
import { resolvePortablePython } from "./python"
import { RELAY_PY_SOURCE } from "./relay-source"

export const DEFAULT_PORT = 7187

// Written out from an embedded string (relay-source.ts), not resolved via
// import.meta.dirname — the packaged desktop app bundles this module into
// out/main/chunks/*.js inside app.asar, and a co-located relay.py never
// makes it into that bundle, so a path-based lookup 404s at runtime.
async function relayScriptPath(): Promise<string> {
  const dest = path.join(Global.Path.bin, "agentrouter-relay.py")
  await fs.writeFile(dest, RELAY_PY_SOURCE)
  return dest
}

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

async function hasWorkingPip(bin: string): Promise<boolean> {
  const out = await Process.run([bin, "-m", "pip", "--version"], { nothrow: true })
  return out.code === 0
}

async function hasAnthropic(bin: string): Promise<boolean> {
  const out = await Process.run([bin, "-c", "import anthropic"], { nothrow: true })
  return out.code === 0
}

// Windows commonly has multiple `python3`/`python` on PATH — Git Bash/MSYS2's
// stripped-down interpreter (no pip module) frequently sorts ahead of the
// real installation. Accepting the first one that merely answers `--version`
// silently breaks the relay later at pip-install time. Walk every candidate
// and pick the first that's actually usable (already has anthropic, or has a
// working pip to install it with). If nothing on PATH clears that bar,
// download a portable CPython (python.ts) instead of guessing further —
// this is what makes AgentRouter work without depending on the system at all.
async function findPython(): Promise<string> {
  const candidates = ["python3", "python", "py -3"]

  for (const bin of candidates) {
    const parts = bin.split(" ")
    const out = await Process.run([...parts, "--version"], { nothrow: true })
    if (out.code !== 0) continue
    if ((await hasAnthropic(bin)) || (await hasWorkingPip(bin))) return bin
  }

  return resolvePortablePython()
}

async function ensureAnthropicPackage(python: string): Promise<void> {
  const parts = python.split(" ")
  if (await hasAnthropic(python)) return
  const install = await Process.run([...parts, "-m", "pip", "install", "--quiet", "anthropic"], { nothrow: true })
  if (install.code !== 0) {
    throw new AgentRouterRelayError(
      `Failed to install the Python "anthropic" package needed by the AgentRouter relay (tried "${python}"):\n${install.stderr.toString().trim()}`,
    )
  }
}

async function start(apiKey: string, port: number): Promise<RelayHandle> {
  const baseURL = `http://127.0.0.1:${port}`

  if (await healthy(baseURL)) return { baseURL }

  const python = await findPython()
  await ensureAnthropicPackage(python)
  const relayScript = await relayScriptPath()

  const child = Process.spawn([...python.split(" "), relayScript], {
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
