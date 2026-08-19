import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"
import { write as writeLog } from "./logging"

// OpenCode's own skill discovery already scans ~/.claude/skills/**/SKILL.md by
// default (see packages/opencode/src/skill/index.ts, CLAUDE_EXTERNAL_DIR) — so
// seeding that folder on first run is enough to make these skills show up,
// no changes to the skill loader itself needed.
const SKILLS_REPO_ZIP = "https://github.com/alltomatos/skills/archive/refs/heads/main.zip"

export async function ensureDefaultSkills() {
  const target = join(homedir(), ".claude", "skills")
  if (existsSync(target)) return

  try {
    const response = await fetch(SKILLS_REPO_ZIP)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = new Uint8Array(await response.arrayBuffer())

    const reader = new ZipReader(new Uint8ArrayReader(buffer))
    const entries = await reader.getEntries()

    let wrote = 0
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
      wrote++
    }
    await reader.close()
    writeLog("default-skills", `seeded ${wrote} files from alltomatos/skills`)
  } catch (error) {
    writeLog("default-skills", `failed to seed default skills: ${String(error)}`, undefined, "warn")
  }
}
