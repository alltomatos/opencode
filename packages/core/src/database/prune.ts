export * as DatabasePrune from "./prune"

import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"

export interface PruneOptions {
  readonly vacuum?: boolean
}

export interface PruneReport {
  readonly deletedEvents: number
  readonly vacuumExecuted: boolean
}

/**
 * Purga de forma segura eventos transitórios intermediários (como message.updated.1)
 * convertendo-os em tombstones leves (data = '{}') sem deletar a linha do EventTable.
 * 
 * Isso preserva 100% da contiguidade da sequência (seq), viabiliza replay idempotente,
 * e ao mesmo tempo elimina os megabytes de payloads inflados de streaming cumulativo.
 * 
 * NUNCA toca nas tabelas `session`, `message`, `part` ou eventos estruturais fundamentais.
 */
export const prune = Effect.fn("DatabasePrune.prune")(function* (
  db: EffectDrizzleSqlite.EffectSQLiteDatabase,
  options?: PruneOptions,
) {
  // 1. Identificar e contar eventos transitórios com payload não vazio (comprimento > 2 caracteres ou != '{}')
  const countRow = yield* db.get<{ count: number }>(
    sql`SELECT count(*) as count FROM \`event\` WHERE \`type\` = 'message.updated.1' AND length(\`data\`) > 2`
  )
  const deletedEvents = countRow?.count ?? 0

  // 2. Converter eventos transitórios inflados em tombstones leves ({}) preservando o seq
  if (deletedEvents > 0) {
    yield* db.run(
      sql`UPDATE \`event\` SET \`data\` = '{}' WHERE \`type\` = 'message.updated.1' AND length(\`data\`) > 2`
    )
  }

  let vacuumExecuted = false
  if (options?.vacuum === true) {
    yield* db.run(sql.raw("VACUUM;"))
    vacuumExecuted = true
  }

  return {
    deletedEvents,
    vacuumExecuted,
  } satisfies PruneReport
})
