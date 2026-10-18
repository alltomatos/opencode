import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261017234719_broad_jane_foster",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`__new_session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_session\`(\`id\`, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_compacting\`, \`time_archived\`) SELECT \`id\`, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_compacting\`, \`time_archived\` FROM \`session\`;`,
      )
      yield* tx.run(`DROP TABLE \`session\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session\` RENAME TO \`session\`;`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_directory_time_created_id_idx\` ON \`session\` (\`directory\`,\`time_created\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
