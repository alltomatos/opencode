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
})
