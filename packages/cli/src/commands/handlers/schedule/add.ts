import { EOL } from "os"
import { Option } from "effect"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.schedule.commands.add,
  Effect.fn("cli.schedule.add")(function* (args) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const workspace = Option.getOrUndefined(args.workspace)
    const response = yield* Effect.promise(() =>
      client.v2.schedule.create({
        scheduleCreateInput: {
          trigger: { kind: "cron", expr: args.cron },
          action: { kind: "shell", command: args.command },
          workspace,
        },
      }),
    )
    if (!response.data) {
      return yield* Effect.fail(new Error(response.error?.message ?? "Failed to create scheduled task"))
    }
    const schedule = response.data
    const trigger = schedule.trigger.kind === "cron" ? schedule.trigger.expr : schedule.trigger.kind
    const action = schedule.action.kind === "shell" ? schedule.action.command : schedule.action.kind
    process.stdout.write(
      `Added scheduled task "${schedule.id}": [${trigger}] -> ${action}${workspace ? ` (workspace: ${workspace})` : ""}` +
        EOL,
    )
  }),
)
