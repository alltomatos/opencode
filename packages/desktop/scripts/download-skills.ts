#!/usr/bin/env ts
import { $ } from "bun"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"

const SKILLS_REPO_ZIP = "https://github.com/alltomatos/skills/archive/refs/heads/main.zip"
const TARGET_DIR = path.join(import.meta.dirname, "..", "resources", "default-skills")

async function downloadSkills() {
  console.log("Downloading skills from GitHub...")
  const response = await fetch(SKILLS_REPO_ZIP)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const buffer = new Uint8Array(await response.arrayBuffer())
  const reader = new ZipReader(new Uint8ArrayReader(buffer))
  const entries = await reader.getEntries()

  await mkdir(TARGET_DIR, { recursive: true })

  let count = 0
  for (const entry of entries) {
    if (entry.directory || !entry.getData) continue

    const match = /^[^/]+\/skills\/(.+)$/.exec(entry.filename)
    if (!match) continue

    const relative = match[1]
    const dest = path.join(TARGET_DIR, relative)
    await mkdir(path.dirname(dest), { recursive: true })
    const data = await entry.getData(new Uint8ArrayWriter())
    await writeFile(dest, data)
    count++
  }

  await reader.close()
  console.log(`Downloaded ${count} skill files`)
}

downloadSkills().catch(error => {
  console.error(error)
  process.exit(1)
})