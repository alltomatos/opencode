import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.schedule.commands.list,
  Effect.fn("cli.schedule.list")(function* () {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const response = yield* Effect.promise(() => client.v2.schedule.list())
    const list = response.data ?? []
    if (list.length === 0) {
      process.stdout.write("No scheduled automation tasks." + EOL)
      return
    }
    for (const item of list) {
      const status = item.lastStatus ? ` [${item.lastStatus}]` : ""
      const lastRun = item.lastRunAt ? ` (last: ${new Date(item.lastRunAt).toISOString()})` : ""
      const ws = item.workspace ? ` [ws: ${item.workspace}]` : ""
      const trigger = item.trigger.kind === "cron" ? item.trigger.expr : item.trigger.kind
      const action =
        item.action.kind === "shell"
          ? item.action.command
          : item.action.kind === "mcp_tool"
            ? `${item.action.server}/${item.action.tool}`
            : `skill:${item.action.instructions}`
      process.stdout.write(`${item.id.padEnd(16)} ${trigger.padEnd(14)} ${action}${ws}${status}${lastRun}` + EOL)
    }
  }),
)
