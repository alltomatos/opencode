import { EOL } from "os"
import { Option } from "effect"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ScheduleRegistry } from "../../../services/schedule-registry"

export default Runtime.handler(
  Commands.commands.schedule.commands.add,
  Effect.fn("cli.schedule.add")(function* (args) {
    const registry = yield* ScheduleRegistry.Service
    const workspace = Option.getOrUndefined(args.workspace)
    const schedule = yield* registry.add({
      cron: args.cron,
      command: args.command,
      workspace,
    })
    process.stdout.write(
      `Added scheduled task "${schedule.id}": [${schedule.cron}] -> ${schedule.command}${workspace ? ` (workspace: ${workspace})` : ""}` +
        EOL,
    )
  }),
)
