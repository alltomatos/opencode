import { EOL } from "os"
import { Option } from "effect"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { EnvironmentRegistry } from "../../../services/environment-registry"

export default Runtime.handler(
  Commands.commands.environment.commands.add,
  Effect.fn("cli.environment.add")(function* (args) {
    const registry = yield* EnvironmentRegistry.Service
    const token = Option.getOrUndefined(args.token)
    const env = yield* registry.add({
      name: args.name,
      url: args.url,
      token,
    })
    process.stdout.write(`Added environment "${env.name}" (${env.id}) -> ${env.url}` + EOL)
  }),
)
