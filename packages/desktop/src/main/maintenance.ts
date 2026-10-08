import { stat } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { app } from "electron"

export type SystemMaintenanceStatus = {
  dbSizeBytes: number
  walSizeBytes: number
  eventCount: number
  largeEventCount: number
  needsMaintenance: boolean
  lastMaintenanceTime?: number
}

export type SystemMaintenanceResult = {
  freedBytes: number
  purgedEvents: number
  durationMs: number
}

export async function getSystemMaintenanceStatus(): Promise<SystemMaintenanceStatus> {
  const userDataPath = app.getPath("userData")
  const dbPath = process.env.OPENCODE_DB ?? join(userDataPath, "opencode.db")
  const walPath = `${dbPath}-wal`

  let dbSizeBytes = 0
  let walSizeBytes = 0
  let eventCount = 0
  let largeEventCount = 0

  try {
    const dbStat = await stat(dbPath).catch(() => null)
    if (dbStat) dbSizeBytes = dbStat.size
  } catch {}

  try {
    const walStat = await stat(walPath).catch(() => null)
    if (walStat) walSizeBytes = walStat.size
  } catch {}

  try {
    const native = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const countRow = native.prepare("SELECT count(*) as cnt FROM event").get() as { cnt: number } | undefined
      if (countRow) eventCount = countRow.cnt

      const largeRow = native
        .prepare("SELECT count(*) as cnt FROM event WHERE length(data) > 1000000")
        .get() as { cnt: number } | undefined
      if (largeRow) largeEventCount = largeRow.cnt
    } finally {
      native.close()
    }
  } catch {}

  // Precisa de manutenção se:
  // - Banco > 1GB
  // - OU WAL acumulado > 50MB
  // - OU mais de 50.000 eventos gravados
  // - OU mais de 50 eventos gigantes (> 1MB)
  const needsMaintenance =
    dbSizeBytes > 1024 * 1024 * 1024 ||
    walSizeBytes > 50 * 1024 * 1024 ||
    eventCount > 50000 ||
    largeEventCount > 50

  return {
    dbSizeBytes,
    walSizeBytes,
    eventCount,
    largeEventCount,
    needsMaintenance,
  }
}

export async function runSystemMaintenance(options?: {
  purgeOldSessions?: boolean
  maxAgeDays?: number
  fullVacuum?: boolean
}): Promise<SystemMaintenanceResult> {
  const start = Date.now()
  const userDataPath = app.getPath("userData")
  const dbPath = process.env.OPENCODE_DB ?? join(userDataPath, "opencode.db")
  const walPath = `${dbPath}-wal`

  let beforeBytes = 0
  try {
    const dbStat = await stat(dbPath).catch(() => null)
    const walStat = await stat(walPath).catch(() => null)
    beforeBytes = (dbStat?.size ?? 0) + (walStat?.size ?? 0)
  } catch {}

  let purgedEvents = 0

  // Abre conexão para manutenção (executa checkpoint, purge de eventos antigos e otimização)
  const native = new DatabaseSync(dbPath)
  try {
    // 1. Trunca o WAL trazendo todas as transações para o arquivo principal
    native.exec("PRAGMA wal_checkpoint(TRUNCATE);")

    // 2. Remove eventos antigos órfãos de mensagens com diffs enormes (> 1MB)
    // Esses eventos 'message.updated.1' contêm históricos duplicados com centenas de megas
    try {
      const deleteResult = native
        .prepare(
          "DELETE FROM event WHERE length(data) > 1000000 AND type = 'message.updated.1'",
        )
        .run()
      purgedEvents += Number(deleteResult.changes)
    } catch {}

    // 3. Expurgo de sessões antigas (padrão: 30 dias se solicitado)
    if (options?.purgeOldSessions) {
      const days = options.maxAgeDays ?? 30
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      try {
        const oldSessions = native
          .prepare("SELECT id FROM session WHERE time_updated < ?")
          .all(cutoff) as Array<{ id: string }>

        for (const s of oldSessions) {
          try {
            // Remove eventos associados
            native.prepare("DELETE FROM event WHERE aggregate_id = ?").run(s.id)
            native.prepare("DELETE FROM event_sequence WHERE aggregate_id = ?").run(s.id)
            // Remove sessão (as tabelas filhas message, part, todo têm ON DELETE CASCADE)
            native.prepare("DELETE FROM session WHERE id = ?").run(s.id)
          } catch {}
        }
      } catch {}
    }

    // 4. Compacta eventos de streaming intermediários (.updated.) em sessões com mais de 7 dias
    try {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const oldEventSessions = native
        .prepare("SELECT id FROM session WHERE time_updated < ?")
        .all(sevenDaysAgo) as Array<{ id: string }>
      
      for (const s of oldEventSessions) {
        try {
          const res = native
            .prepare("DELETE FROM event WHERE aggregate_id = ? AND type LIKE '%.updated.%'")
            .run(s.id)
          purgedEvents += Number(res.changes)
        } catch {}
      }
    } catch {}

    // 5. Otimiza índices e estatísticas do SQLite
    native.exec("PRAGMA optimize;")

    // 6. Checkpoint final
    native.exec("PRAGMA wal_checkpoint(TRUNCATE);")

    // 7. Se solicitado VACUUM completo (reorganiza fisicamente o banco no disco)
    if (options?.fullVacuum) {
      try {
        native.exec("VACUUM;")
      } catch {}
    }
  } finally {
    native.close()
  }

  let afterBytes = 0
  try {
    const dbStat = await stat(dbPath).catch(() => null)
    const walStat = await stat(walPath).catch(() => null)
    afterBytes = (dbStat?.size ?? 0) + (walStat?.size ?? 0)
  } catch {}

  const freedBytes = Math.max(0, beforeBytes - afterBytes)
  const durationMs = Date.now() - start

  return {
    freedBytes,
    purgedEvents,
    durationMs,
  }
}
