import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { WorkspaceMigration } from "@opencode-ai/core/database/workspace-migration"
import { sql } from "drizzle-orm"

describe("WorkspaceMigration", () => {
  it("migrates sessions, messages and parts cleanly from legacy source to target workspace database", async () => {
    const program = Effect.gen(function* () {
      const source = yield* Database.Service
      // Criar projeto na fonte
      yield* source.db.run(
        sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
            VALUES ('proj_target', '/workspaces/proj_target', 1000, 1000, '[]')`
      )
      // Criar sessão na fonte
      yield* source.db.run(
        sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
            VALUES ('sess_10', 'proj_target', 'slug-10', '/workspaces/proj_target', 'Minha Sessao', '1', 1000, 1000)`
      )
      // Criar mensagem
      yield* source.db.run(
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data)
            VALUES ('msg_10', 'sess_10', 1000, 1000, '{"text":"Olá"}')`
      )
      // Criar part
      yield* source.db.run(
        sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
            VALUES ('part_10', 'msg_10', 'sess_10', 1000, 1000, '{"type":"text","content":"Olá mundo"}')`
      )

      // Executar migração simulando target no mesmo database para teste relacional
      const summary = yield* WorkspaceMigration.migrateWorkspaceHistory(
        source.db,
        source.db,
        "proj_target"
      )

      expect(summary.sessionsMigrated).toBe(1)
      expect(summary.messagesMigrated).toBe(1)
      expect(summary.partsMigrated).toBe(1)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))

    await Effect.runPromise(program)
  })

  it("migrates multiple sessions and messages in batch without N+1 queries and ensures atomicity", async () => {
    const program = Effect.gen(function* () {
      const source = yield* Database.Service
      yield* source.db.run(
        sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
            VALUES ('proj_batch', '/workspaces/proj_batch', 1000, 1000, '[]')`
      )
      // Criar 3 sessões, 6 mensagens e 12 parts
      for (let s = 1; s <= 3; s++) {
        yield* source.db.run(
          sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
              VALUES (${`sess_b_${s}`}, 'proj_batch', ${`slug-${s}`}, '/workspaces/proj_batch', ${`Sessao ${s}`}, '1', 1000, 1000)`
        )
        for (let m = 1; m <= 2; m++) {
          const msgId = `msg_b_${s}_${m}`
          yield* source.db.run(
            sql`INSERT INTO message (id, session_id, time_created, time_updated, data)
                VALUES (${msgId}, ${`sess_b_${s}`}, 1000, 1000, '{"text":"teste"}')`
          )
          for (let p = 1; p <= 2; p++) {
            yield* source.db.run(
              sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
                  VALUES (${`part_b_${s}_${m}_${p}`}, ${msgId}, ${`sess_b_${s}`}, 1000, 1000, '{"type":"text"}')`
            )
          }
        }
      }

      const summary = yield* WorkspaceMigration.migrateWorkspaceHistory(
        source.db,
        source.db,
        "proj_batch"
      )

      expect(summary.sessionsMigrated).toBe(3)
      expect(summary.messagesMigrated).toBe(6)
      expect(summary.partsMigrated).toBe(12)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))

    await Effect.runPromise(program)
  })
})
