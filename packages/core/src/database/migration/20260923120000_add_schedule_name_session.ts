import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923120000_add_schedule_name_session",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        ALTER TABLE \`schedule\` ADD COLUMN \`name\` text;
      `)
      yield* tx.run(`
        ALTER TABLE \`schedule\` ADD COLUMN \`description\` text;
      `)
      yield* tx.run(`
        ALTER TABLE \`schedule\` ADD COLUMN \`last_session_id\` text;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
