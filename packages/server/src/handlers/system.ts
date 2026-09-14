import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Api } from "../api"

export const SystemHandler = HttpApiBuilder.group(Api, "server.system", (handlers) =>
  handlers.handle(
    "system.update",
    Effect.fn(function* (ctx) {
      if (!ctx.payload.confirm) {
        return yield* new HttpApiError.BadRequest()
      }

      yield* Effect.logInfo(`[System] Remote update triggered by authenticated client`)

      // Spawn update in background so response can be sent to client first
      setTimeout(() => {
        try {
          const { spawn } = require("node:child_process")
          const proc = spawn("bun install -g @opencode-ai/cli@latest", {
            shell: true,
            detached: true,
            stdio: "ignore",
          })
          proc.unref()
        } catch {
          // ignore
        }
      }, 500)

      return {
        status: "updating",
        message: "Update initiated. Daemon will restart after installation.",
        currentVersion: InstallationVersion,
      }
    }),
  ),
)
