#!/usr/bin/env bun
import { $ } from "bun"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
const desktopPkg = await Bun.file(join(import.meta.dirname, "..", "package.json")).json()
process.env.OPENCODE_VERSION ??= desktopPkg.version
process.env.OPENCODE_CHANNEL ??= channel

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`bun build ../mcpmail/src/index.ts --target=node --outfile=./resources/mcpmail/index.js`

await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()

// Download skills and bundle them into the installer
console.log("Downloading skills for packaging...")
const response = await fetch(
  "https://github.com/alltomatos/skills/archive/refs/heads/main.zip",
)
if (!response.ok) throw new Error(`HTTP ${response.status}`)

const buffer = new Uint8Array(await response.arrayBuffer())
const reader = new ZipReader(new Uint8ArrayReader(buffer))
const entries = await reader.getEntries()

const targetDir = join(import.meta.dirname, "..", "resources", "default-skills")
await mkdir(targetDir, { recursive: true })

let count = 0
for (const entry of entries) {
  if (entry.directory || !entry.getData) continue

  const match = /^[^/]+\/skills\/(.+)$/.exec(entry.filename)
  if (!match) continue

  const relative = match[1]
  const dest = join(targetDir, relative)
  await mkdir(join(dest, ".."), { recursive: true })
  const data = await entry.getData(new Uint8ArrayWriter())
  await writeFile(dest, data)
  count++
}

await reader.close()
console.log(`Downloaded ${count} skill files to resources/default-skills`)
