import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionLocationTable } from "@opencode-ai/core/session/location.sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { WorkspaceMigration } from "@opencode-ai/core/database/workspace-migration"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import type { LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@opencode/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

const decodeSessionID = Schema.decodeUnknownEffect(SessionV2.ID)

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
          Effect.mapError(
            () =>
              new InvalidRequestError({
                message: "Invalid session ID",
                field: "sessionID",
              }),
          ),
        )
        // 1. Resolução estrita O(1) pelo índice global session_location
        let resolved = yield* db
          .select({ directory: SessionLocationTable.directory, workspaceID: SessionLocationTable.workspace_id })
          .from(SessionLocationTable)
          .where(eq(SessionLocationTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)

        // 2. Auto-reconciliação resiliente: se a sessão existe na tabela legado session do global.db
        // mas ainda não foi projetada ou o índice não foi inserido, reconcilia imediatamente.
        if (!resolved) {
          const fallback = yield* db
            .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get()
            .pipe(Effect.orDie)

          if (fallback) {
            resolved = fallback
            yield* db
              .insert(SessionLocationTable)
              .values({
                session_id: sessionID,
                directory: fallback.directory,
                workspace_id: fallback.workspaceID,
                workspace_hash: WorkspaceMigration.directoryToWorkspaceHash(fallback.directory),
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
          }
        }

        if (!resolved)
          return yield* new SessionNotFoundError({
            sessionID,
            message: `Session not found: ${sessionID}`,
          })

        return yield* effect.pipe(
          Effect.provide(
            locations.get(
              Location.Ref.make({
                directory: AbsolutePath.make(resolved.directory),
                workspaceID: resolved.workspaceID ? WorkspaceV2.ID.make(resolved.workspaceID) : undefined,
              }),
            ),
          ),
        )
      }),
    )
  }),
)
