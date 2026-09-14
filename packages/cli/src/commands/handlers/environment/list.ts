import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { EnvironmentRegistry } from "../../../services/environment-registry"

export default Runtime.handler(
  Commands.commands.environment.commands.list,
  Effect.fn("cli.environment.list")(function* () {
    const registry = yield* EnvironmentRegistry.Service
    const list = yield* registry.list()
    if (list.length === 0) {
      process.stdout.write("No saved environments." + EOL)
      return
    }
    for (const item of list) {
      const paired = item.lastPairedAt ? ` (last paired: ${new Date(item.lastPairedAt).toISOString()})` : ""
      process.stdout.write(`${item.name.padEnd(20)} ${item.id.padEnd(16)} ${item.url}${paired}` + EOL)
    }
  }),
)
