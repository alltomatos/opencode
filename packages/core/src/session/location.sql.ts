import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { SessionSchema } from "../session/schema"
import type { WorkspaceV2 } from "../workspace"

export const SessionLocationTable = sqliteTable(
  "session_location",
  {
    session_id: text().$type<SessionSchema.ID>().primaryKey(),
    directory: text().notNull(),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    workspace_hash: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("session_location_directory_idx").on(table.directory),
    index("session_location_workspace_id_idx").on(table.workspace_id),
    index("session_location_workspace_hash_idx").on(table.workspace_hash),
  ],
)
