// Client for the bug-relay service (bugrepcode.alltomatos.com.br), which
// turns bug reports — manual (user-triggered) or auto (uncaught error) —
// into deduped GitHub issues on alltomatos/opencode. The relay holds the
// only GitHub credential in this flow; this module never touches GitHub
// directly, and works whether or not the machine running the fork has
// `gh` installed or is authenticated.
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

const RELAY_URL = process.env["OPENCODE_BUG_RELAY_URL"] ?? "https://bugrepcode.alltomatos.com.br/report"
const RELAY_KEY = process.env["OPENCODE_BUG_RELAY_KEY"]

const SETTINGS_PATH = path.join(Global.Path.state, "bug-relay.json")
const QUEUE_PATH = path.join(Global.Path.state, "bug-relay-queue.json")

export interface BugReport {
  source: "manual" | "auto"
  title: string
  body: string
  signature: string
  context?: {
    appVersion?: string
    platform?: string
    sessionId?: string
  }
}

interface Settings {
  enabled: boolean
}

// Default-on: telemetry ships automatically unless the user opts out.
// Reports never carry conversation content, file paths, or env vars — only
// the error signature/stack and coarse version/platform metadata, so this
// module must stay that way at every call site that builds a BugReport.
const DEFAULT_SETTINGS: Settings = { enabled: true }

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

export async function isTelemetryEnabled(): Promise<boolean> {
  const settings = await readJson(SETTINGS_PATH, DEFAULT_SETTINGS)
  return settings.enabled
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await writeJson(SETTINGS_PATH, { enabled })
}

async function readQueue(): Promise<BugReport[]> {
  return readJson<BugReport[]>(QUEUE_PATH, [])
}

async function writeQueue(reports: BugReport[]) {
  await writeJson(QUEUE_PATH, reports)
}

async function enqueue(report: BugReport) {
  const queue = await readQueue()
  queue.push(report)
  await writeQueue(queue)
}

async function send(report: BugReport): Promise<boolean> {
  if (!RELAY_KEY) return false
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-key": RELAY_KEY },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

// Best-effort: a failed send is queued and retried on the next flush rather
// than dropped or retried inline (retrying inline would block whatever
// triggered the report — worst case an error handler in the crash path).
export async function reportBug(report: BugReport): Promise<void> {
  if (!(await isTelemetryEnabled())) return
  const ok = await send(report)
  if (!ok) await enqueue(report)
}

// Call once at startup. Drains the local queue built up while the relay or
// the network was unreachable; reports that fail again go right back on the
// queue for the next attempt.
export async function flushQueuedReports(): Promise<void> {
  if (!(await isTelemetryEnabled())) return
  const queue = await readQueue()
  if (queue.length === 0) return
  await writeQueue([])
  const remaining: BugReport[] = []
  for (const report of queue) {
    if (!(await send(report))) remaining.push(report)
  }
  if (remaining.length > 0) await writeQueue(remaining)
}

// Stable across runs for the same error shape: normalizes away paths,
// line/column numbers, and addresses so the same underlying bug produces
// the same signature regardless of machine or build. Used by the relay to
// dedupe against existing GitHub issues instead of spamming a new one per
// occurrence.
export function signatureFromStack(stack: string): string {
  const normalized = stack
    .split("\n")
    .slice(0, 5)
    .map((line) =>
      line
        .replace(/[a-zA-Z]:[\\/][^\s)]+|\/[^\s)]+/g, "<path>")
        .replace(/:\d+:\d+/g, "")
        .trim(),
    )
    .join("\n")
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (Math.imul(31, hash) + normalized.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16)
}
