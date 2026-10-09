export * as DefaultPython from "./default-python"

import { existsSync, readdirSync } from "node:fs"
import { readdir, mkdir, rm, rename } from "node:fs/promises"
import { join } from "node:path"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

// Pinned astral-sh/python-build-standalone release for cross-platform vendorized Python 3.12.
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

export function getVendorPythonDir(home: string): string {
  return join(home, ".opencode", "python")
}

export function findVendorPythonSync(home: string): { binDir: string; pythonPath: string; scriptsDir?: string } | null {
  const baseDir = getVendorPythonDir(home)
  if (!existsSync(baseDir)) return null

  try {
    const entries = readdirSync(baseDir)
    const match = entries.find((e) => e.startsWith("cpython-3.12") && !e.endsWith(".temp"))
    if (!match) return null

    const fullPath = join(baseDir, match)
    if (process.platform === "win32") {
      const pythonExe = join(fullPath, "python.exe")
      if (existsSync(pythonExe)) {
        const scripts = join(fullPath, "Scripts")
        return {
          binDir: fullPath,
          pythonPath: pythonExe,
          scriptsDir: existsSync(scripts) ? scripts : undefined,
        }
      }
    } else {
      const binDir = join(fullPath, "bin")
      const python3 = join(binDir, "python3")
      if (existsSync(python3)) {
        return {
          binDir,
          pythonPath: python3,
        }
      }
    }
  } catch {
    // ignore
  }

  return null
}


export async function findVendorPython(home: string): Promise<{ binDir: string; pythonPath: string; scriptsDir?: string } | null> {
  const baseDir = getVendorPythonDir(home)
  if (!existsSync(baseDir)) return null

  try {
    const entries = await readdir(baseDir)
    const match = entries.find((e) => e.startsWith("cpython-3.12") && !e.endsWith(".temp"))
    if (!match) return null

    const fullPath = join(baseDir, match)
    if (process.platform === "win32") {
      const pythonExe = join(fullPath, "python.exe")
      if (existsSync(pythonExe)) {
        const scripts = join(fullPath, "Scripts")
        return {
          binDir: fullPath,
          pythonPath: pythonExe,
          scriptsDir: existsSync(scripts) ? scripts : undefined,
        }
      }
    } else {
      const binDir = join(fullPath, "bin")
      const python3 = join(binDir, "python3")
      if (existsSync(python3)) {
        return {
          binDir,
          pythonPath: python3,
        }
      }
    }
  } catch {
    // ignore
  }

  return null
}

let ensuringPromise: Promise<void> | null = null

export function ensureDefaultPython(home: string): Promise<void> {
  ensuringPromise ??= ensurePythonInternal(home).catch((err) => {
    ensuringPromise = null
    console.warn("default-python: failed to provision standalone Python 3.12:", err)
  })
  return ensuringPromise
}

async function ensurePythonInternal(home: string): Promise<void> {
  const existing = await findVendorPython(home)
  if (existing) return

  const token = assetToken()
  if (!token) return

  const targetBase = getVendorPythonDir(home)
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

  await Filesystem.writeStream(archivePath, res.body)

  const tempExtract = join(targetBase, ".extract-temp")
  await rm(tempExtract, { recursive: true, force: true })
  await mkdir(tempExtract, { recursive: true })

  const extract = await Process.run(["tar", "-xzf", archivePath], { cwd: tempExtract, nothrow: true })
  await rm(archivePath, { force: true })

  if (extract.code !== 0) {
    await rm(tempExtract, { recursive: true, force: true })
    throw new Error(`tar extract failed: ${extract.stderr.toString().trim()}`)
  }

  // Astral standalone archives extract into a folder named "python"
  const extractedPython = join(tempExtract, "python")
  if (existsSync(extractedPython)) {
    await rename(extractedPython, installPath)
  }
  await rm(tempExtract, { recursive: true, force: true })
}
