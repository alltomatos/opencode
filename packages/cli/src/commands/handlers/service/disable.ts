import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { PersistentService } from "../../../services/persistent-service"

export default Runtime.handler(
  Commands.commands.service.commands.disable,
  Effect.fn("cli.service.disable")(function* () {
    const result = yield* Effect.promise(() => PersistentService.disable())
    if (result.exitCode !== 0) {
      process.stdout.write(`Failed to remove persistent service: ${result.stderr || result.stdout}` + EOL)
      process.exitCode = 1
      return
    }
    process.stdout.write("Removed the persistent login service." + EOL)
  }),
)
