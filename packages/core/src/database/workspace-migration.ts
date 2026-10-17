export * as WorkspaceMigration from "./workspace-migration"

import { Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"

export interface MigrationSummary {
  readonly sessionsMigrated: number
  readonly messagesMigrated: number
  readonly partsMigrated: number
}

/**
 * Retorna o caminho absoluto do banco de dados particionado por workspace.
 */
export function getWorkspaceDatabasePath(workspaceHash: string): string {
  const sanitized = workspaceHash.replace(/[^a-zA-Z0-9._-]/g, "_")
  return path.join(Global.Path.data, "workspaces", sanitized, "project.db")
}

/**
 * Garante a criação do diretório do workspace antes de abrir o banco particionado.
 */
export const ensureWorkspaceDatabaseDir = Effect.fn("WorkspaceMigration.ensureDir")(function* (
  workspaceHash: string,
) {
  const dbPath = getWorkspaceDatabasePath(workspaceHash)
  yield* Effect.promise(() => fs.mkdir(path.dirname(dbPath), { recursive: true }))
  return dbPath
})

/**
 * Migra com segurança e sem perda de dados o histórico de um workspace específico
 * do banco legado (origem) para a base particionada do workspace (destino).
 */
export const migrateWorkspaceHistory = Effect.fn("WorkspaceMigration.migrate")(function* (
  sourceDb: EffectDrizzleSqlite.EffectSQLiteDatabase,
  targetDb: EffectDrizzleSqlite.EffectSQLiteDatabase,
  projectIdOrDirectory: string,
) {
  // 1. Localizar sessões elegíveis
  const sessions = yield* sourceDb
    .all<{
      id: string
      project_id: string
      workspace_id: string | null
      parent_id: string | null
      slug: string
      directory: string
      path: string | null
      title: string
      version: string
      time_created: number
      time_updated: number
    }>(
      sql`SELECT id, project_id, workspace_id, parent_id, slug, directory, path, title, version, time_created, time_updated
          FROM session
          WHERE project_id = ${projectIdOrDirectory} OR directory = ${projectIdOrDirectory}`
    )
    .pipe(Effect.orDie)

  let messagesCount = 0
  let partsCount = 0

  for (const s of sessions) {
    // Upsert da sessão na base destino
    yield* targetDb.run(
      sql`INSERT INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, time_created, time_updated)
          VALUES (${s.id}, ${s.project_id}, ${s.workspace_id}, ${s.parent_id}, ${s.slug}, ${s.directory}, ${s.path}, ${s.title}, ${s.version}, ${s.time_created}, ${s.time_updated})
          ON CONFLICT(id) DO UPDATE SET title = ${s.title}, time_updated = ${s.time_updated}`
    )

    // Buscar mensagens da sessão
    const messages = yield* sourceDb
      .all<{ id: string; session_id: string; time_created: number; time_updated: number; data: string }>(
        sql`SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id = ${s.id}`
      )
      .pipe(Effect.orDie)

    for (const m of messages) {
      yield* targetDb.run(
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data)
            VALUES (${m.id}, ${m.session_id}, ${m.time_created}, ${m.time_updated}, ${m.data})
            ON CONFLICT(id) DO UPDATE SET data = ${m.data}, time_updated = ${m.time_updated}`
      )
      messagesCount++
    }

    // Buscar parts da sessão
    const parts = yield* sourceDb
      .all<{ id: string; message_id: string; session_id: string; time_created: number; time_updated: number; data: string }>(
        sql`SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id = ${s.id}`
      )
      .pipe(Effect.orDie)

    for (const p of parts) {
      yield* targetDb.run(
        sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
            VALUES (${p.id}, ${p.message_id}, ${p.session_id}, ${p.time_created}, ${p.time_updated}, ${p.data})
            ON CONFLICT(id) DO UPDATE SET data = ${p.data}, time_updated = ${p.time_updated}`
      )
      partsCount++
    }
  }

  return {
    sessionsMigrated: sessions.length,
    messagesMigrated: messagesCount,
    partsMigrated: partsCount,
  } satisfies MigrationSummary
})
