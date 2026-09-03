import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { SshKeyInfo } from "@opencode-ai/app/ssh-tunnel/types"

const SKIP_NAMES = new Set(["known_hosts", "known_hosts.old", "config", "authorized_keys"])

// A private key file has no reliable extension convention (id_ed25519,
// id_rsa, a custom name...) — the one thing that actually distinguishes it
// from config/known_hosts/backups is the PEM/OpenSSH header on its first
// line, so we peek at that instead of guessing from the filename.
async function looksLikePrivateKey(path: string): Promise<boolean> {
  try {
    const handle = await readFile(path, { encoding: "utf8" })
    const firstLine = handle.split(/\r?\n/, 1)[0] ?? ""
    return firstLine.includes("PRIVATE KEY")
  } catch {
    return false
  }
}

export async function listSshKeys(): Promise<SshKeyInfo[]> {
  const dir = join(homedir(), ".ssh")
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const candidates = entries.filter((name) => !name.endsWith(".pub") && !SKIP_NAMES.has(name) && !name.endsWith(".bak"))

  const results = await Promise.all(
    candidates.map(async (name) => {
      const path = join(dir, name)
      return (await looksLikePrivateKey(path)) ? { path, name } : null
    }),
  )
  return results.filter((x): x is SshKeyInfo => x !== null)
}
