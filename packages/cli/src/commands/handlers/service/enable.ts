import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { PersistentService } from "../../../services/persistent-service"

export default Runtime.handler(
  Commands.commands.service.commands.enable,
  Effect.fn("cli.service.enable")(function* () {
    const result = yield* Effect.promise(() => PersistentService.enable())
    if (result.exitCode !== 0) {
      process.stdout.write(`Failed to install persistent service: ${result.stderr || result.stdout}` + EOL)
      process.exitCode = 1
      return
    }
    process.stdout.write("Installed opencode as a persistent login service." + EOL)
  }),
)
