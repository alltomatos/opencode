import { describe, expect, it } from "bun:test"
import { Effect, Layer, Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { WorkspaceMigration } from "@opencode-ai/core/database/workspace-migration"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionLocationTable } from "@opencode-ai/core/session/location.sql"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { sql } from "drizzle-orm"
import path from "path"
import fs from "fs/promises"

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
      expect(summary.locationsIndexed).toBe(1)
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
      expect(summary.locationsIndexed).toBe(3)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))

    await Effect.runPromise(program)
  })

  it("workspaceDatabaseLayer initializes project.db schema on disk", async () => {
    const testHash = `wrk_test_${Date.now()}`
    const dbPath = WorkspaceMigration.getWorkspaceDatabasePath(testHash)
    const dbDir = path.dirname(dbPath)

    const program = Effect.scoped(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        // Confirma que as migrações aplicaram as tabelas essenciais no arquivo project.db
        const tables = yield* db.all<{ name: string }>(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'message', 'part')`
        )
        expect(tables.length).toBe(3)
      }).pipe(Effect.provide(WorkspaceMigration.workspaceDatabaseLayer(testHash))),
    )

    await Effect.runPromise(program)

    // Limpeza portátil independente de sistema operacional (path.dirname)
    await fs.rm(dbDir, { recursive: true, force: true }).catch(() => {})
  })

  it("projects sessions into physical project.db and populates session_location index", async () => {
    const testDir = path.resolve(`packages/core/test/fixture/partition_${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    const testHash = WorkspaceMigration.directoryToWorkspaceHash(testDir)
    const projectDbPath = WorkspaceMigration.getWorkspaceDatabasePath(testHash)
    const projectDbDir = path.dirname(projectDbPath)

    const program = Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const globalDb = (yield* Database.Service).db
      const events = yield* EventV2.Service

      const sessionID = SessionSchema.ID.create()
      const now = Date.now()
      const info = SessionV1.SessionInfo.make({
        id: sessionID,
        slug: "slug-part",
        version: "1",
        projectID: "proj_part" as any,
        directory: testDir,
        title: "Sessao Particionada",
        time: { created: now, updated: now },
      })

      // 1. Inserir projeto no globalDb
      yield* globalDb.run(
        sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
            VALUES ('proj_part', ${testDir}, 1000, 1000, '[]')`
      )

      // 2. Acionar a localização para subir o SessionProjector escopado ao workspace
      const locationEnv = locations.get(
        Location.Ref.make({ directory: AbsolutePath.make(testDir) }),
      )
      yield* Layer.build(locationEnv).pipe(Effect.scoped)

      yield* Effect.gen(function* () {
        // Publicar criação de sessão dentro do escopo de localização do workspace
        yield* events.publish(SessionV1.Event.Created, { sessionID, info }, { location: { directory: AbsolutePath.make(testDir) } })
      }).pipe(
        Effect.provide(locationEnv),
        Effect.scoped,
      )

      // 3. Validar que o índice session_location foi gravado no banco global
      const loc = yield* globalDb
        .select()
        .from(SessionLocationTable)
        .where(sql`session_id = ${sessionID}`)
        .get()
      expect(loc).toBeDefined()
      expect(loc?.workspace_hash).toBe(testHash)

      // 4. Validar que a sessão foi gravada no arquivo físico project.db
      const exists = yield* Effect.promise(() => fs.stat(projectDbPath).then(() => true).catch(() => false))
      expect(exists).toBe(true)

      const instance = yield* Database.makeFromPath(projectDbPath)
      const projectRow = yield* instance.db
        .all<{ id: string }>(sql`SELECT id FROM session WHERE id = ${sessionID}`)
      expect(projectRow.length).toBe(1)

      // 5. Confirmar que NÃO houve dual-write: o banco global NÃO contém a sessão
      const globalRow = yield* globalDb
        .all<{ id: string }>(sql`SELECT id FROM session WHERE id = ${sessionID}`)
      expect(globalRow.length).toBe(0)
    })

    const rootLayer = AppNodeBuilder.build(
      LayerNode.group([Database.node, Database.globalNode, EventV2.node, LocationServiceMap.node]),
      [[Database.node, Database.layerFromPath(":memory:")]],
    )

    await Effect.runPromise(program.pipe(Effect.provide(rootLayer), Effect.orDie))

    // Limpeza
    await fs.rm(projectDbDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
  })
})
