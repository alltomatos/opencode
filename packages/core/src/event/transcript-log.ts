export * as TranscriptLog from "./transcript-log"

import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"

export interface TranscriptEntry {
  readonly id: string
  readonly aggregateID: string
  readonly seq: number
  readonly type: string
  readonly data: unknown
  readonly timestamp?: number
}

function getTranscriptsDir(workspaceHash?: string): string {
  if (workspaceHash) {
    return path.join(Global.Path.data, "workspaces", workspaceHash, "transcripts")
  }
  return path.join(Global.Path.data, "transcripts")
}

/**
 * Retorna o caminho absoluto do arquivo de transcrição JSONL para um dado aggregateID (session_id).
 */
export function getTranscriptPath(aggregateID: string, workspaceHash?: string): string {
  const sanitized = aggregateID.replace(/[^a-zA-Z0-9._-]/g, "_")
  return path.join(getTranscriptsDir(workspaceHash), `${sanitized}.jsonl`)
}

/**
 * Append atômico O(1) de um evento de streaming em arquivo JSONL no sistema de arquivos.
 * Evita completamente locks e inchaço no banco de dados SQLite.
 */
export const append = Effect.fn("TranscriptLog.append")(function* (
  entry: TranscriptEntry,
  workspaceHash?: string,
) {
  const filePath = getTranscriptPath(entry.aggregateID, workspaceHash)
  const dir = path.dirname(filePath)

  yield* Effect.promise(async () => {
    await fs.mkdir(dir, { recursive: true })
    const line = JSON.stringify({
      id: entry.id,
      aggregateID: entry.aggregateID,
      seq: entry.seq,
      type: entry.type,
      data: entry.data,
      time: entry.timestamp ?? Date.now(),
    }) + "\n"
    await fs.appendFile(filePath, line, "utf8")
  })
})

/**
 * Lê as linhas de transcrição do arquivo JSONL de uma sessão.
 */
export const readLines = Effect.fn("TranscriptLog.readLines")(function* (
  aggregateID: string,
  workspaceHash?: string,
) {
  const filePath = getTranscriptPath(aggregateID, workspaceHash)
  return yield* Effect.promise(async () => {
    try {
      const content = await fs.readFile(filePath, "utf8")
      return content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TranscriptEntry)
    } catch (err: any) {
      if (err.code === "ENOENT") return []
      throw err
    }
  })
})
