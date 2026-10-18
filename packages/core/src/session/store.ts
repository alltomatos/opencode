export * as SessionStore from "./store"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionHistory } from "./history"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { SessionLocationTable } from "./location.sql"
import { fromRow } from "./info"
import { Location } from "../location"
import { LocationsResolver } from "../location-resolver"
import { AbsolutePath } from "../schema"
import { WorkspaceV2 } from "../workspace"

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
    const resolver = yield* LocationsResolver.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        // 1. Tenta buscar no banco atual (global.db ou project.db ativo)
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        if (row) return fromRow(row)

        // 2. Se não encontrou, busca no índice global session_location para localizar o project.db da sessão
        const loc = yield* db
          .select({
            directory: SessionLocationTable.directory,
            workspaceID: SessionLocationTable.workspace_id,
          })
          .from(SessionLocationTable)
          .where(eq(SessionLocationTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)

        if (!loc) return undefined

        // 3. Lê a sessão do project.db da location pelo dono único das conexões
        // (LocationsResolver), o mesmo Database.Interface que os serviços de
        // location usam para essa ref.
        const workspace = yield* resolver.get(
          Location.Ref.make({
            directory: AbsolutePath.make(loc.directory),
            workspaceID: loc.workspaceID ? WorkspaceV2.ID.make(loc.workspaceID) : undefined,
          }),
        )

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

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, LocationsResolver.node] })
