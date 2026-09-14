import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ScheduleRegistry } from "../../../services/schedule-registry"

export default Runtime.handler(
  Commands.commands.schedule.commands.rm,
  Effect.fn("cli.schedule.rm")(function* (args) {
    const registry = yield* ScheduleRegistry.Service
    const removed = yield* registry.rm(args.id)
    if (!removed) {
      process.stdout.write(`Scheduled task "${args.id}" not found.` + EOL)
      return
    }
    process.stdout.write(`Removed scheduled task "${args.id}".` + EOL)
  }),
)
