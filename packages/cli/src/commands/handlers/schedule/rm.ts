import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.schedule.commands.rm,
  Effect.fn("cli.schedule.rm")(function* (args) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const response = yield* Effect.promise(() => client.v2.schedule.remove({ scheduleID: args.id }))
    if (response.error) {
      process.stdout.write(`Scheduled task "${args.id}" not found.` + EOL)
      return
    }
    process.stdout.write(`Removed scheduled task "${args.id}".` + EOL)
  }),
)
