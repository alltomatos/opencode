import { existsSync } from "node:fs"
import { mkdir, copyFile, readdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DEFAULT_SKILLS_SOURCE = join(__dirname, "skills", "default-skills")

export async function ensureDefaultSkills() {
  const target = join(homedir(), ".opencode", "skills")

  if (existsSync(target)) {
    return
  }

  try {
    await mkdir(target, { recursive: true })

    const sourceExists = existsSync(DEFAULT_SKILLS_SOURCE)
    if (sourceExists) {
      await copySkillsRecursive(DEFAULT_SKILLS_SOURCE, target)
      console.log("default-skills", `seeded skills from bundled default-skills`)
    }
  } catch (error) {
    console.warn("default-skills", `failed to seed default skills: ${String(error)}`, error)
  }
}

async function copySkillsRecursive(src: string, dest: string) {
  const entries = await readdir(src, { withFileTypes: true, recursive: true })

  for (const entry of entries) {
    const entryPath = join(src, entry.name)

    if (entry.isDirectory()) {
      await mkdir(join(dest, entry.name), { recursive: true })
      await copySkillsRecursive(entryPath, join(dest, entry.name))
    } else if (entry.isFile()) {
      await copyFile(entryPath, join(dest, entry.name))
    }
  }
}