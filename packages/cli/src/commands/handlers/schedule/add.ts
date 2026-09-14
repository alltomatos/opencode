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
      trigger: { kind: "cron", expr: args.cron },
      action: { kind: "shell", command: args.command },
      workspace,
    })
    const trigger = schedule.trigger.kind === "cron" ? schedule.trigger.expr : schedule.trigger.kind
    const action = schedule.action.kind === "shell" ? schedule.action.command : schedule.action.kind
    process.stdout.write(
      `Added scheduled task "${schedule.id}": [${trigger}] -> ${action}${workspace ? ` (workspace: ${workspace})` : ""}` +
        EOL,
    )
  }),
)
