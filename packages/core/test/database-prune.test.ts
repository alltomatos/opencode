import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { DatabasePrune } from "@opencode-ai/core/database/prune"
import { sql } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))

describe("DatabasePrune", () => {
  it.effect(
    "prunes transient message.updated.1 events without affecting sessions, messages or parts",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service

        // Inserir projeto de teste (para satisfazer FK de session)
        yield* db.run(
          sql`INSERT INTO \`project\` (\`id\`, \`worktree\`, \`time_created\`, \`time_updated\`, \`sandboxes\`) 
              VALUES ('proj_1', '/test', 1000, 1000, '[]')`
        )

        // Inserir sessão de teste
        yield* db.run(
          sql`INSERT INTO \`session\` (\`id\`, \`project_id\`, \`slug\`, \`directory\`, \`title\`, \`version\`, \`time_created\`, \`time_updated\`) 
              VALUES ('sess_1', 'proj_1', 'test-session', '/test', 'Test Session', '1', 1000, 1000)`
        )

        // Inserir mensagem de teste
        yield* db.run(
          sql`INSERT INTO \`message\` (\`id\`, \`session_id\`, \`time_created\`, \`time_updated\`, \`data\`) 
              VALUES ('msg_1', 'sess_1', 1000, 1000, '{"role":"assistant"}')`
        )

        // Inserir parte consolidada
        yield* db.run(
          sql`INSERT INTO \`part\` (\`id\`, \`message_id\`, \`session_id\`, \`time_created\`, \`time_updated\`, \`data\`) 
              VALUES ('part_1', 'msg_1', 'sess_1', 1000, 1000, '{"type":"text","content":"Resposta final completa"}')`
        )

        // Inserir sequência de eventos
        yield* db.run(
          sql`INSERT INTO \`event_sequence\` (\`aggregate_id\`, \`seq\`) VALUES ('sess_1', 5)`
        )

        // Inserir eventos: um permanente e múltiplos transitórios inflados
        yield* db.run(
          sql`INSERT INTO \`event\` (\`id\`, \`aggregate_id\`, \`seq\`, \`type\`, \`data\`) 
              VALUES ('ev_created', 'sess_1', 1, 'session.created.1', '{"title":"Test Session"}')`
        )
        yield* db.run(
          sql`INSERT INTO \`event\` (\`id\`, \`aggregate_id\`, \`seq\`, \`type\`, \`data\`) 
              VALUES ('ev_upd_1', 'sess_1', 2, 'message.updated.1', '{"partial":"Res"}')`
        )
        yield* db.run(
          sql`INSERT INTO \`event\` (\`id\`, \`aggregate_id\`, \`seq\`, \`type\`, \`data\`) 
              VALUES ('ev_upd_2', 'sess_1', 3, 'message.updated.1', '{"partial":"Respos"}')`
        )
        yield* db.run(
          sql`INSERT INTO \`event\` (\`id\`, \`aggregate_id\`, \`seq\`, \`type\`, \`data\`) 
              VALUES ('ev_upd_3', 'sess_1', 4, 'message.updated.1', '{"partial":"Resposta final"}')`
        )

        // Executar o prune
        const report = yield* DatabasePrune.prune(db, { vacuum: false })

        expect(report.deletedEvents).toBe(3)

        // Verificar que eventos estruturais (ex: session.created.1) NÃO foram tocados
        const remainingEvents = yield* db.all<{ id: string; type: string }>(
          sql`SELECT \`id\`, \`type\` FROM \`event\` WHERE \`aggregate_id\` = 'sess_1'`
        )
        expect(remainingEvents.length).toBe(1)
        expect(remainingEvents[0].type).toBe("session.created.1")

        // Verificar que as tabelas de sessão, mensagem e partes continuam 100% INTACTAS
        const sessions = yield* db.all<{ id: string }>(sql`SELECT \`id\` FROM \`session\` WHERE \`id\` = 'sess_1'`)
        const messages = yield* db.all<{ id: string }>(sql`SELECT \`id\` FROM \`message\` WHERE \`id\` = 'msg_1'`)
        const parts = yield* db.all<{ id: string }>(sql`SELECT \`id\` FROM \`part\` WHERE \`id\` = 'part_1'`)

        expect(sessions.length).toBe(1)
        expect(messages.length).toBe(1)
        expect(parts.length).toBe(1)
      })
  )
})
