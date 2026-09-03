export * as DefaultSkills from "./default-skills"

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"

// Mirrors packages/desktop/src/main/default-skills.ts — the desktop app
// seeds this same folder for the bundled Electron server, but a headless
// `opencode serve`/`opencode web` on a bare VPS never goes through that
// code path, so it never got the base skill set. Seeding it here instead
// (once, on server boot) makes CLI-only deployments behave the same as the
// desktop app instead of silently missing every default skill.
const SKILLS_REPO_ZIP = "https://github.com/alltomatos/skills/archive/refs/heads/main.zip"

export async function ensureDefaultSkills(home: string): Promise<void> {
  const target = join(home, ".opencode", "skills")
  if (existsSync(target)) return

  try {
    const response = await fetch(SKILLS_REPO_ZIP)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = new Uint8Array(await response.arrayBuffer())

    const reader = new ZipReader(new Uint8ArrayReader(buffer))
    const entries = await reader.getEntries()

    for (const entry of entries) {
      if (entry.directory || !entry.getData) continue
      // Zip entries are rooted at "<repo>-<branch>/..." — only pull files
      // under that root's "skills/" folder, matching the loader's glob.
      const match = /^[^/]+\/skills\/(.+)$/.exec(entry.filename)
      if (!match) continue
      const relative = match[1]

      const dest = join(target, relative)
      await mkdir(dirname(dest), { recursive: true })
      const data = await entry.getData(new Uint8ArrayWriter())
      await writeFile(dest, data)
    }
    await reader.close()
  } catch {
    // Best-effort — a missing base skill set shouldn't stop the server
    // from starting; the user can still install skills manually.
  }
}
