import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260915124709_blue_mother_askani",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_directory_time_created_id_idx\` ON \`session\` (\`directory\`,\`time_created\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
