import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ScheduleRegistry } from "../../../services/schedule-registry"

export default Runtime.handler(
  Commands.commands.schedule.commands.list,
  Effect.fn("cli.schedule.list")(function* () {
    const registry = yield* ScheduleRegistry.Service
    const list = yield* registry.list()
    if (list.length === 0) {
      process.stdout.write("No scheduled automation tasks." + EOL)
      return
    }
    for (const item of list) {
      const status = item.lastStatus ? ` [${item.lastStatus}]` : ""
      const lastRun = item.lastRunAt ? ` (last: ${new Date(item.lastRunAt).toISOString()})` : ""
      const ws = item.workspace ? ` [ws: ${item.workspace}]` : ""
      process.stdout.write(
        `${item.id.padEnd(16)} ${item.cron.padEnd(14)} ${item.command}${ws}${status}${lastRun}` + EOL,
      )
    }
  }),
)
