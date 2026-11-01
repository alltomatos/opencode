import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261017150000_add_session_location_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`
        CREATE TABLE IF NOT EXISTS \`session_location\` (
          \`session_id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`workspace_id\` text,
          \`workspace_hash\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        )
      `)
      yield* tx.run(sql`
        CREATE INDEX IF NOT EXISTS \`session_location_directory_idx\` ON \`session_location\` (\`directory\`)
      `)
      yield* tx.run(sql`
        CREATE INDEX IF NOT EXISTS \`session_location_workspace_id_idx\` ON \`session_location\` (\`workspace_id\`)
      `)
      yield* tx.run(sql`
        CREATE INDEX IF NOT EXISTS \`session_location_workspace_hash_idx\` ON \`session_location\` (\`workspace_hash\`)
      `)
    })
  },
} satisfies DatabaseMigration.Migration
