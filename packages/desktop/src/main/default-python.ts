import { existsSync } from "node:fs"
import { readdir, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

const RELEASE_TAG = "20241016"
const PYTHON_VERSION = "3.12.7"

const PLATFORM_TOKENS: Partial<Record<string, Partial<Record<string, string>>>> = {
  win32: { x64: "x86_64-pc-windows-msvc" },
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  linux: { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" },
}

function assetToken(): string | null {
  return PLATFORM_TOKENS[process.platform]?.[process.arch] ?? null
}

export function getVendorPythonDir(): string {
  return join(homedir(), ".opencode", "python")
}

export async function ensureDefaultPython(): Promise<void> {
  const token = assetToken()
  if (!token) return

  const targetBase = getVendorPythonDir()
  if (existsSync(targetBase)) {
    try {
      const entries = await readdir(targetBase)
      const existing = entries.find((e) => e.startsWith("cpython-3.12") && !e.endsWith(".temp"))
      if (existing) return
    } catch {
      // proceed to download
    }
  }

  try {
    await mkdir(targetBase, { recursive: true })
    const folderName = `cpython-${PYTHON_VERSION}-${token}`
    const installPath = join(targetBase, folderName)
    if (existsSync(installPath)) return

    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${token}-install_only.tar.gz`
    const archiveName = "python-install.tar.gz"
    const archivePath = join(targetBase, archiveName)

    const res = await fetch(url)
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} downloading python from ${url}`)
    }

    const nodeStream = Readable.fromWeb(res.body as any)
    await pipeline(nodeStream, createWriteStream(archivePath))

    const tempExtract = join(targetBase, ".extract-temp")
    await rm(tempExtract, { recursive: true, force: true })
    await mkdir(tempExtract, { recursive: true })

    await new Promise<void>((resolve, reject) => {
      const tar = spawn("tar", ["-xzf", archivePath], { cwd: tempExtract, stdio: "ignore" })
      tar.on("error", reject)
      tar.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar exited with code ${code}`))
      })
    })

    await rm(archivePath, { force: true })

    const extracted = join(tempExtract, "python")
    if (existsSync(extracted)) {
      const { rename } = await import("node:fs/promises")
      await rename(extracted, installPath)
      console.log("default-python", `successfully installed portable Python 3.12 to ${installPath}`)
    }
    await rm(tempExtract, { recursive: true, force: true })
  } catch (error) {
    console.warn("default-python", `failed to seed default python: ${String(error)}`, error)
  }
}
