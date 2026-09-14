export * as ScheduleRunner from "./schedule-runner"

import { Context, Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { ScheduleRegistry, matchesCron } from "./schedule-registry"

export interface Interface {
  readonly tick: () => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/ScheduleRunner") {}

function executeCommand(command: string, cwd?: string): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, {
        shell: true,
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stderr = ""
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString()
      })

      proc.on("close", (code) => {
        resolve({
          exitCode: code ?? 0,
          error: code !== 0 ? stderr.trim() || `Process exited with code ${code}` : undefined,
        })
      })

      proc.on("error", (err) => {
        resolve({
          exitCode: 1,
          error: err.message,
        })
      })
    } catch (err: any) {
      resolve({
        exitCode: 1,
        error: err?.message ?? String(err),
      })
    }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* ScheduleRegistry.Service

    const tick = Effect.fn("cli.schedule.tick")(function* () {
      const now = new Date()
      const nowMs = now.getTime()
      const schedules = yield* registry.list()

      for (const schedule of schedules) {
        if (schedule.enabled === false) continue

        // Skip if already executed in this minute
        if (schedule.lastRunAt && nowMs - schedule.lastRunAt < 59_000) {
          continue
        }

        if (matchesCron(schedule.cron, now)) {
          yield* Effect.logInfo(`[Schedule] Executing task ${schedule.id}: "${schedule.command}"`)
          const result = yield* Effect.promise(() => executeCommand(schedule.command, schedule.workspace))

          yield* registry.update(schedule.id, {
            lastRunAt: nowMs,
            lastStatus: result.exitCode === 0 ? "success" : "error",
            lastError: result.error,
          })

          if (result.exitCode === 0) {
            yield* Effect.logInfo(`[Schedule] Task ${schedule.id} completed successfully`)
          } else {
            yield* Effect.logWarning(`[Schedule] Task ${schedule.id} failed: ${result.error}`)
          }
        }
      }
    })

    return Service.of({ tick })
  }),
)
