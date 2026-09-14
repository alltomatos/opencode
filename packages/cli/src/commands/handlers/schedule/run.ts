import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.schedule.commands.run,
  Effect.fn("cli.schedule.run")(function* (args) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const response = yield* Effect.promise(() => client.v2.schedule.run({ scheduleID: args.id }))
    if (!response.data) {
      process.stdout.write(`Failed to run scheduled task "${args.id}": ${response.error?.message ?? "unknown error"}` + EOL)
      process.exitCode = 1
      return
    }
    const schedule = response.data
    if (schedule.lastStatus === "error") {
      process.stdout.write(`Task "${args.id}" failed: ${schedule.lastError ?? "unknown error"}` + EOL)
      process.exitCode = 1
      return
    }
    process.stdout.write(`Task "${args.id}" completed successfully.` + EOL)
  }),
)
