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
 * cujo conteúdo consolidado já reside com 100% de integridade nas tabelas relacionais
 * de `message` e `part`.
 * 
 * NUNCA toca nas tabelas `session`, `message`, `part` ou eventos estruturais fundamentais.
 */
export const prune = Effect.fn("DatabasePrune.prune")(function* (
  db: EffectDrizzleSqlite.EffectSQLiteDatabase,
  options?: PruneOptions,
) {
  // 1. Identificar e contar eventos transitórios redundantes de streaming
  const countRow = yield* db.get<{ count: number }>(
    sql`SELECT count(*) as count FROM \`event\` WHERE \`type\` = 'message.updated.1'`
  )
  const deletedEvents = countRow?.count ?? 0

  // 2. Executar delete seguro dos eventos transitórios
  if (deletedEvents > 0) {
    yield* db.run(sql`DELETE FROM \`event\` WHERE \`type\` = 'message.updated.1'`)
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
