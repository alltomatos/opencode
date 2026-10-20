import { stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { app } from "electron"

export interface LegacyInstallationSource {
  id: string
  name: string
  dbPath: string
  sessionCount: number
  dbSizeBytes: number
}

export interface LegacySessionSummary {
  id: string
  title: string
  directory: string
  timeUpdated: number
  messageCount: number
}

export interface LegacyMigrationResult {
  migratedSessions: number
  migratedMessages: number
  migratedParts: number
  migratedEvents: number
}

function directoryToWorkspaceHash(directory: string): string {
  const normalized = process.platform === "win32" ? directory.replace(/\\/g, "/").toLowerCase() : directory
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

/**
 * Procura bancos de dados opencode.db em instalações padrão do Electron e CLI
 */
export async function detectLegacyInstallations(): Promise<LegacyInstallationSource[]> {
  const currentDbPath = process.env.OPENCODE_DB ?? join(app.getPath("userData"), "opencode.db")

  const candidates: { id: string; name: string; path: string }[] = []

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    candidates.push(
      { id: "desktop-prod", name: "OpenCode Desktop (Oficial)", path: join(appData, "ai.opencode.desktop", "opencode.db") },
      { id: "desktop-dev", name: "OpenCode Desktop (Dev)", path: join(appData, "ai.opencode.desktop.dev", "opencode.db") },
      { id: "desktop-beta", name: "OpenCode Desktop (Beta)", path: join(appData, "ai.opencode.desktop.beta", "opencode.db") },
    )
  } else if (process.platform === "darwin") {
    const appSupport = join(homedir(), "Library", "Application Support")
    candidates.push(
      { id: "desktop-prod", name: "OpenCode Desktop (Oficial)", path: join(appSupport, "ai.opencode.desktop", "opencode.db") },
      { id: "desktop-dev", name: "OpenCode Desktop (Dev)", path: join(appSupport, "ai.opencode.desktop.dev", "opencode.db") },
      { id: "desktop-beta", name: "OpenCode Desktop (Beta)", path: join(appSupport, "ai.opencode.desktop.beta", "opencode.db") },
    )
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    candidates.push(
      { id: "desktop-prod", name: "OpenCode Desktop", path: join(xdgConfig, "ai.opencode.desktop", "opencode.db") },
    )
  }

  // CLI / Global path
  const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  candidates.push({
    id: "cli-global",
    name: "OpenCode CLI (~/.local/share)",
    path: join(xdgData, "opencode", "opencode.db"),
  })

  const results: LegacyInstallationSource[] = []

  for (const cand of candidates) {
    if (cand.path === currentDbPath) continue
    if (!existsSync(cand.path)) continue

    try {
      const fileStat = await stat(cand.path)
      const native = new DatabaseSync(cand.path, { readOnly: true })
      try {
        const row = native.prepare("SELECT count(*) as count FROM session").get() as { count: number } | undefined
        const sessionCount = row?.count ?? 0
        if (sessionCount > 0) {
          results.push({
            id: cand.id,
            name: cand.name,
            dbPath: cand.path,
            sessionCount,
            dbSizeBytes: fileStat.size,
          })
        }
      } finally {
        native.close()
      }
    } catch {}
  }

  return results
}

/**
 * Lista as sessões de um banco SQLite legado com contagem de mensagens
 */
export async function listLegacySessions(
  sourceDbPath: string,
  targetDirectory?: string,
): Promise<LegacySessionSummary[]> {
  if (!existsSync(sourceDbPath)) return []

  const native = new DatabaseSync(sourceDbPath, { readOnly: true })
  try {
    let query = "SELECT id, title, directory, time_updated FROM session ORDER BY time_updated DESC"
    const params: (string | number | bigint | null)[] = []

    if (targetDirectory) {
      const normTarget = targetDirectory.replace(/\\/g, "/").toLowerCase()
      // Filtra por diretório similar
      query = "SELECT id, title, directory, time_updated FROM session WHERE lower(replace(directory, '\\', '/')) = ? ORDER BY time_updated DESC"
      params.push(normTarget)
    }

    const rows = (params.length > 0 ? native.prepare(query).all(...params) : native.prepare(query).all()) as Array<{
      id: string
      title: string
      directory: string
      time_updated: number
    }>

    const msgCountStmt = native.prepare("SELECT count(*) as count FROM message WHERE session_id = ?")

    return rows.map((r) => {
      let messageCount = 0
      try {
        const mc = msgCountStmt.get(r.id) as { count: number } | undefined
        messageCount = mc?.count ?? 0
      } catch {}

      return {
        id: r.id,
        title: r.title || r.id,
        directory: r.directory,
        timeUpdated: r.time_updated,
        messageCount,
      }
    })
  } finally {
    native.close()
  }
}

/**
 * Importa sessões selecionadas do banco legado para o banco particionado do workspace atual
 */
export async function importLegacySessions(
  sourceDbPath: string,
  sessionIDs: string[],
  targetDirectory: string,
): Promise<LegacyMigrationResult> {
  if (!existsSync(sourceDbPath) || sessionIDs.length === 0) {
    return { migratedSessions: 0, migratedMessages: 0, migratedParts: 0, migratedEvents: 0 }
  }

  const workspaceHash = directoryToWorkspaceHash(targetDirectory)
  const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  const targetDbDir = join(xdgData, "opencode", "workspaces", workspaceHash)
  const targetDbPath = join(targetDbDir, "project.db")
  const globalDbPath = process.env.OPENCODE_DB ?? join(app.getPath("userData"), "opencode.db")

  const source = new DatabaseSync(sourceDbPath, { readOnly: true })
  const target = new DatabaseSync(targetDbPath)
  const globalDb = new DatabaseSync(globalDbPath)

  let migratedSessions = 0
  let migratedMessages = 0
  let migratedParts = 0
  let migratedEvents = 0

  try {
    const placeholders = sessionIDs.map(() => "?").join(",")

    // 1. Carregar sessões de origem
    const sessions = source
      .prepare(
        `SELECT id, project_id, workspace_id, parent_id, slug, directory, path, title, version, time_created, time_updated
         FROM session WHERE id IN (${placeholders})`,
      )
      .all(...sessionIDs) as Array<{
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
    }>

    // 2. Carregar mensagens
    const messages = source
      .prepare(
        `SELECT id, session_id, time_created, time_updated, data
         FROM message WHERE session_id IN (${placeholders})`,
      )
      .all(...sessionIDs) as Array<{
      id: string
      session_id: string
      time_created: number
      time_updated: number
      data: string
    }>

    // 3. Carregar parts
    const parts = source
      .prepare(
        `SELECT id, message_id, session_id, time_created, time_updated, data
         FROM part WHERE session_id IN (${placeholders})`,
      )
      .all(...sessionIDs) as Array<{
      id: string
      message_id: string
      session_id: string
      time_created: number
      time_updated: number
      data: string
    }>

    // 4. Carregar events e event_sequences
    const events = source
      .prepare(
        `SELECT id, aggregate_id, seq, type, data
         FROM event WHERE aggregate_id IN (${placeholders}) ORDER BY seq ASC`,
      )
      .all(...sessionIDs) as Array<{
      id: string
      aggregate_id: string
      seq: number
      type: string
      data: string
    }>

    const sequences = source
      .prepare(
        `SELECT aggregate_id, seq, owner_id
         FROM event_sequence WHERE aggregate_id IN (${placeholders})`,
      )
      .all(...sessionIDs) as Array<{
      aggregate_id: string
      seq: number
      owner_id: string | null
    }>

    // Gravação em transação no project.db
    target.exec("BEGIN TRANSACTION;")
    try {
      const insertSession = target.prepare(
        `INSERT INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, time_updated = excluded.time_updated`,
      )

      for (const s of sessions) {
        insertSession.run(
          s.id,
          s.project_id,
          s.workspace_id,
          s.parent_id,
          s.slug,
          targetDirectory, // Vincula ao diretório do projeto atual
          s.path,
          s.title,
          s.version,
          s.time_created,
          s.time_updated,
        )
        migratedSessions++
      }

      const insertMsg = target.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, time_updated = excluded.time_updated`,
      )
      for (const m of messages) {
        insertMsg.run(m.id, m.session_id, m.time_created, m.time_updated, m.data)
        migratedMessages++
      }

      const insertPart = target.prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, time_updated = excluded.time_updated`,
      )
      for (const p of parts) {
        insertPart.run(p.id, p.message_id, p.session_id, p.time_created, p.time_updated, p.data)
        migratedParts++
      }

      const insertSeq = target.prepare(
        `INSERT INTO event_sequence (aggregate_id, seq, owner_id)
         VALUES (?, ?, ?)
         ON CONFLICT(aggregate_id) DO UPDATE SET seq = excluded.seq, owner_id = excluded.owner_id`,
      )
      for (const seq of sequences) {
        insertSeq.run(seq.aggregate_id, seq.seq, seq.owner_id)
      }

      const insertEv = target.prepare(
        `INSERT INTO event (id, aggregate_id, seq, type, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      for (const ev of events) {
        insertEv.run(ev.id, ev.aggregate_id, ev.seq, ev.type, ev.data)
        migratedEvents++
      }

      target.exec("COMMIT;")
    } catch (e) {
      target.exec("ROLLBACK;")
      throw e
    }

    // 5. Atualizar o índice session_location no globalDb
    globalDb.exec("BEGIN TRANSACTION;")
    try {
      const insertLoc = globalDb.prepare(
        `INSERT INTO session_location (session_id, directory, workspace_id, workspace_hash, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           directory = excluded.directory,
           workspace_id = excluded.workspace_id,
           workspace_hash = excluded.workspace_hash,
           time_updated = excluded.time_updated`,
      )

      for (const s of sessions) {
        insertLoc.run(s.id, targetDirectory, s.workspace_id, workspaceHash, s.time_created, s.time_updated)
      }
      globalDb.exec("COMMIT;")
    } catch (e) {
      globalDb.exec("ROLLBACK;")
      throw e
    }

    return {
      migratedSessions,
      migratedMessages,
      migratedParts,
      migratedEvents,
    }
  } finally {
    source.close()
    target.close()
    globalDb.close()
  }
}
