import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260914135618_add_schedule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`schedule\` (
          \`id\` text PRIMARY KEY,
          \`trigger\` text NOT NULL,
          \`action\` text NOT NULL,
          \`workspace\` text,
          \`enabled\` integer NOT NULL,
          \`last_run_at\` integer,
          \`last_status\` text,
          \`last_error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
