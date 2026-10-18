export * as SessionStore from "./store"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionHistory } from "./history"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { SessionLocationTable } from "./location.sql"
import { LayerNode } from "../effect/layer-node"
import { fromRow } from "./info"

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info | undefined>
  readonly context: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly runnerContext: (
    sessionID: SessionSchema.ID,
    baselineSeq: number,
  ) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: SessionSchema.ID; readonly message: SessionMessage.Message } | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    // Um project.db por workspace, reutilizado pelo tempo de vida da camada.
    const workspaceDatabases = new Map<string, Database.Interface>()

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        // 1. Tenta buscar no banco atual (global.db ou project.db ativo)
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        if (row) return fromRow(row)

        // 2. Se não encontrou, busca no índice global session_location para localizar o project.db da sessão
        const loc = yield* db
          .select({ workspaceHash: SessionLocationTable.workspace_hash })
          .from(SessionLocationTable)
          .where(eq(SessionLocationTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)

        if (!loc) return undefined

        // 3. Lê a sessão do project.db da location, reutilizando a conexão por workspace
        const existing = workspaceDatabases.get(loc.workspaceHash)
        const workspace =
          existing ??
          Context.get(
            yield* Layer.build(LayerNode.compile(Database.locationNode(loc.workspaceHash))).pipe(Scope.provide(scope)),
            Database.Service,
          )
        if (!existing) workspaceDatabases.set(loc.workspaceHash, workspace)

        const projectRow = yield* workspace.db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return projectRow ? fromRow(projectRow) : undefined
      }),
      context: Effect.fn("SessionStore.context")(function* (sessionID) {
        return yield* SessionHistory.load(db, sessionID)
      }),
      runnerContext: Effect.fn("SessionStore.runnerContext")(function* (sessionID, baselineSeq) {
        return yield* SessionHistory.loadForRunner(db, sessionID, baselineSeq)
      }),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: SessionSchema.ID.make(row.session_id),
              message: yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
            }
          : undefined
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
