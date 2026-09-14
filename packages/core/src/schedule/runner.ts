export * as ScheduleRunner from "./runner"

import { spawn } from "node:child_process"
import { Duration, Effect, Layer, Schema, Schedule as EffectSchedule } from "effect"
import { Schedule } from "../schedule"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Schedule.NotFoundError", {
  id: Schedule.ID,
}) {}

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
        resolve({ exitCode: 1, error: err.message })
      })
    } catch (err: any) {
      resolve({ exitCode: 1, error: err?.message ?? String(err) })
    }
  })
}

/**
 * mcp_tool/skill actions need MCP.Service and Session/Batuta, which don't have
 * a V2/core runtime yet (see #213 discussion) -- they're recorded and skipped
 * with a clear error rather than silently no-op'd, until those land.
 */
function runAction(action: Schedule.Action, workspace: string | undefined) {
  if (action.kind === "shell") return Effect.promise(() => executeCommand(action.command, workspace))
  return Effect.succeed({
    exitCode: 1,
    error: `Action kind "${action.kind}" is not yet supported by the schedule runner.`,
  })
}

/** Runs one schedule's action immediately, regardless of trigger/enabled state, and records the result. */
export const runOne = Effect.fn("v2.Schedule.runOne")(function* (id: Schedule.ID) {
  const schedules = yield* Schedule.Service
  const schedule = yield* schedules.get(id)
  if (!schedule) return yield* Effect.fail(new NotFoundError({ id }))

  const result = yield* runAction(schedule.action, schedule.workspace)
  const updated = yield* schedules.update(schedule.id, {
    lastRunAt: Date.now(),
    lastStatus: result.exitCode === 0 ? "success" : "error",
    lastError: result.error,
  })
  return updated!
})

const tick = Effect.fn("v2.Schedule.tick")(function* () {
  const schedules = yield* Schedule.Service
  const now = new Date()
  const nowMs = now.getTime()

  for (const schedule of yield* schedules.list()) {
    if (!schedule.enabled) continue
    if (schedule.trigger.kind === "manual") continue

    if (schedule.trigger.kind === "interval") {
      if (schedule.lastRunAt && nowMs - schedule.lastRunAt < schedule.trigger.ms) continue
    } else {
      if (schedule.lastRunAt && nowMs - schedule.lastRunAt < 59_000) continue
      if (!Schedule.matchesCron(schedule.trigger.expr, now)) continue
    }

    const result = yield* runAction(schedule.action, schedule.workspace)
    yield* schedules.update(schedule.id, {
      lastRunAt: nowMs,
      lastStatus: result.exitCode === 0 ? "success" : "error",
      lastError: result.error,
    })

    if (result.exitCode === 0) yield* Effect.logInfo(`[Schedule] Task ${schedule.id} completed successfully`)
    else yield* Effect.logWarning(`[Schedule] Task ${schedule.id} failed: ${result.error}`)
  }
})

const tickLayer = Layer.effectDiscard(
  tick().pipe(
    Effect.catch(() => Effect.void),
    Effect.repeat(EffectSchedule.spaced(Duration.seconds(30))),
    Effect.forkScoped,
  ),
)

export const tickNode = makeGlobalNode({
  name: "schedule-tick",
  layer: Layer.merge(Schedule.layer, tickLayer.pipe(Layer.provide(Schedule.layer))),
  deps: [Database.node],
})
