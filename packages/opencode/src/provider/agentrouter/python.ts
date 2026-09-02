import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

// Pinned astral-sh/python-build-standalone release. These are the same
// portable CPython builds `uv` uses. We deliberately use the "install_only"
// .tar.gz variant (never .tar.zst) so extraction can shell out to a plain
// `tar -xzf` — the same technique every LSP installer in ../../lsp/server.ts
// already relies on — without needing a zstd-capable tar or a new JS
// dependency. Bump RELEASE_TAG/PYTHON_VERSION together when updating.
const RELEASE_TAG = "20241016"
const PYTHON_VERSION = "3.12.7"

const PLATFORM_TOKENS: Partial<Record<string, Partial<Record<string, string>>>> = {
  win32: { x64: "x86_64-pc-windows-msvc" },
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  linux: { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" },
}

function assetToken(): string {
  const token = PLATFORM_TOKENS[process.platform]?.[process.arch]
  if (!token) {
    throw new Error(
      `No portable Python build available for platform "${process.platform}"/"${process.arch}". ` +
        "Install Python 3.9+ manually to use the AgentRouter provider.",
    )
  }
  return token
}

function installDir(): string {
  return path.join(Global.Path.bin, `agentrouter-python-${PYTHON_VERSION}-${assetToken()}`)
}

function pythonBinary(dir: string): string {
  return process.platform === "win32" ? path.join(dir, "python", "python.exe") : path.join(dir, "python", "bin", "python3")
}

async function exists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false)
}

let installing: Promise<string> | undefined

// Downloads and extracts a portable CPython on first use so the AgentRouter
// relay never depends on guessing which python3/python on PATH actually has
// a working pip (see manager.ts's findPython — that bug is exactly why this
// exists). Cached forever in Global.Path.bin once extracted.
export function resolvePortablePython(): Promise<string> {
  installing ??= install().catch((err) => {
    installing = undefined
    throw err
  })
  return installing
}

async function install(): Promise<string> {
  const dir = installDir()
  const python = pythonBinary(dir)
  if (await exists(python)) return python

  const token = assetToken()
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${token}-install_only.tar.gz`

  await fs.mkdir(dir, { recursive: true })
  const archiveName = "python.tar.gz"
  const archivePath = path.join(dir, archiveName)

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download portable Python from ${url}: HTTP ${response.status}`)
  }
  await Filesystem.writeStream(archivePath, response.body)

  // Pass a bare filename + cwd (not the absolute path) to tar — MSYS/Cygwin
  // tar on Windows parses a leading "C:" in an absolute path as a remote
  // "host:path" spec and fails with "Cannot connect to C: resolve failed".
  // Every tar call in ../../lsp/server.ts uses this same cwd-relative form.
  const extract = await Process.run(["tar", "-xzf", archiveName], { cwd: dir, nothrow: true })
  await fs.rm(archivePath, { force: true })
  if (extract.code !== 0) {
    throw new Error(`Failed to extract portable Python archive:\n${extract.stderr.toString().trim()}`)
  }

  if (!(await exists(python))) {
    throw new Error(`Portable Python extracted to ${dir} but expected binary not found at ${python}`)
  }

  return python
}
