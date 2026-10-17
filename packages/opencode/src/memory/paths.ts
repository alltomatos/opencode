import { Global } from "@opencode-ai/core/global"
import { WorkspaceMigration } from "@opencode-ai/core/database/workspace-migration"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

export function projectKey(directory: string) {
  return directory.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(-80) || "root"
}

export function todayFile() {
  return `${new Date().toISOString().slice(0, 10)}.md`
}

export function globalDir() {
  return path.join(Global.Path.data, "memory", "global")
}

export function workspaceMemoryDir(directory: string) {
  const hash = WorkspaceMigration.directoryToWorkspaceHash(directory)
  return path.join(Global.Path.data, "workspaces", hash, "memory")
}

export function legacyWorkspaceMemoryDir(directory: string) {
  const legacyHash = projectKey(directory)
  return path.join(Global.Path.data, "workspaces", legacyHash, "memory")
}

export function legacyProjectDir(directory: string) {
  return path.join(Global.Path.data, "memory", "projects", projectKey(directory))
}

export function projectDir(directory: string) {
  return workspaceMemoryDir(directory)
}

export function processedSessionsFile() {
  return path.join(Global.Path.data, "memory", "processed_sessions.json")
}

export function syncStateFile() {
  return path.join(Global.Path.data, "memory", "sync_state.json")
}

export async function appendMemoryEntry(file: string, entry: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const existing = await readFile(file, "utf8").catch(() => "")
  await writeFile(file, existing + entry, "utf8")
}

export async function readRecentMemoryFiles(dir: string, count: number) {
  const entries = await readdir(dir).catch(() => [] as string[])
  const files = entries
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .slice(-count)
  const contents = await Promise.all(files.map((file) => readFile(path.join(dir, file), "utf8").catch(() => "")))
  return contents.filter(Boolean).join("\n")
}

/**
 * Lê arquivos de memória combinando o diretório de workspace unificado SHA-256,
 * o diretório legado de transição (projectKey sob workspaces/) e o legado original,
 * garantindo Zero Data Loss e imunidade contra colisão de caminhos.
 */
export async function readRecentProjectMemoryFiles(directory: string, count: number) {
  const primaryDir = workspaceMemoryDir(directory)
  const legacyHashDir = legacyWorkspaceMemoryDir(directory)
  const legacyDir = legacyProjectDir(directory)

  const [primaryContent, legacyHashContent, legacyContent] = await Promise.all([
    readRecentMemoryFiles(primaryDir, count),
    readRecentMemoryFiles(legacyHashDir, count),
    readRecentMemoryFiles(legacyDir, count),
  ])

  return [legacyContent, legacyHashContent, primaryContent].filter(Boolean).join("\n")
}
