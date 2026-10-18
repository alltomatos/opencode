import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { DatabasePrune } from "@opencode-ai/core/database/prune"
import { EventLogBackfill } from "@opencode-ai/core/database/event-log-backfill"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

const BackfillCommand = effectCmd({
  command: "backfill",
  describe: "idempotently backfill durable event log from global.db to workspace project.db files",
  instance: false,
  handler: Effect.fn("Cli.db.backfill")(function* () {
    const { db } = yield* Database.Service
    console.log("Iniciando backfill idempotente do event log para project.db...")
    const summary = yield* EventLogBackfill.runOneShot(db).pipe(Effect.orDie)
    console.log(
      `Backfill concluído: ${summary.events} eventos e ${summary.sequences} sequências migradas em ${summary.workspaces} workspace(s) (${summary.aggregates} agregados, ${summary.skippedAggregates} ignorados sem workspace).`,
    )
  }),
})

const PruneCommand = effectCmd({
  command: "prune",
  describe: "prune transient streaming events and optionally run vacuum",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.option("vacuum", {
      type: "boolean",
      default: true,
      describe: "reclaim space with SQLite VACUUM after pruning",
    })
  },
  handler: Effect.fn("Cli.db.prune")(function* (args: { vacuum: boolean }) {
    const { db } = yield* Database.Service
    console.log("Iniciando purga segura de eventos transitórios redundantes...")
    const report = yield* DatabasePrune.prune(db, { vacuum: args.vacuum }).pipe(Effect.orDie)
    console.log(`Eventos transitórios removidos: ${report.deletedEvents}`)
    if (report.vacuumExecuted) {
      console.log("VACUUM executado com sucesso. Espaço em disco recuperado.")
    }
  }),
})

const QueryCommand = effectCmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(PruneCommand).command(BackfillCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
