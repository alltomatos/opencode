import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { EnvironmentRegistry } from "../../../services/environment-registry"

export default Runtime.handler(
  Commands.commands.environment.commands.rm,
  Effect.fn("cli.environment.rm")(function* (args) {
    const registry = yield* EnvironmentRegistry.Service
    const removed = yield* registry.rm(args.idOrName)
    if (removed) {
      process.stdout.write(`Removed environment "${args.idOrName}".` + EOL)
    } else {
      process.stderr.write(`Environment "${args.idOrName}" not found.` + EOL)
    }
  }),
)
