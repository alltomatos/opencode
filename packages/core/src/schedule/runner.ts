export * as ScheduleRunner from "./runner"

import { spawn } from "node:child_process"
import { Context, Duration, Effect, Layer, Schema, Schedule as EffectSchedule } from "effect"
import { Schedule } from "../schedule"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Schedule.NotFoundError", {
  id: Schedule.ID,
}) {}

export interface McpCallResult {
  readonly success: boolean
  readonly error?: string
}

export interface McpCallerInterface {
  readonly callTool: (
    server: string,
    tool: string,
    args: Record<string, unknown> | undefined,
  ) => Effect.Effect<McpCallResult>
}

/**
 * mcp_tool actions call an MCP client living in the legacy opencode process
 * (packages/opencode's MCP.Service), which packages/core can't depend on
 * directly. This is a swappable dependency: packages/opencode replaces this
 * node with a real implementation wired to its MCP.Service; anything running
 * without that process (the standalone V2 daemon) keeps this "unsupported"
 * default instead of silently no-op'ing.
 */
export class McpCaller extends Context.Service<McpCaller, McpCallerInterface>()("@opencode/v2/Schedule/McpCaller") {}

const mcpCallerUnsupportedLayer = Layer.succeed(
  McpCaller,
  McpCaller.of({
    callTool: () =>
      Effect.succeed({
        success: false,
        error: "mcp_tool actions require the desktop app's MCP connections, not available in this server process.",
      }),
  }),
)

export const mcpCallerNode = makeGlobalNode({ service: McpCaller, layer: mcpCallerUnsupportedLayer, deps: [] })

const DEFAULT_TIMEOUT_MS = 300_000

function executeCommand(
  command: string,
  cwd?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, {
        shell: true,
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stderr = ""
      let settled = false
      let timer: NodeJS.Timeout | undefined

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return
          settled = true
          try {
            if (process.platform === "win32") {
              proc.kill()
            } else {
              proc.kill("SIGKILL")
            }
          } catch {
            // ignore kill errors
          }
          resolve({ exitCode: 1, error: `timeout after ${timeoutMs}ms` })
        }, timeoutMs)
        timer.unref?.()
      }

      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString()
      })

      proc.on("close", (code) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        const exitCode = code === 0 ? 0 : (code ?? 1)
        resolve({
          exitCode,
          error: exitCode !== 0 ? stderr.trim() || `Process exited with code ${code}` : undefined,
        })
      })

      proc.on("error", (err) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve({ exitCode: 1, error: err.message })
      })
    } catch (err: any) {
      resolve({ exitCode: 1, error: err?.message ?? String(err) })
    }
  })
}

/**
 * skill actions need Session/Batuta, which don't have a V2/core runtime yet
 * (see #213/#217 discussion) -- recorded and skipped with a clear error
 * rather than silently no-op'd, until that lands. mcp_tool is handled via
 * the swappable McpCaller dependency above.
 */
function runAction(action: Schedule.Action, workspace: string | undefined) {
  const timeoutMs =
    "timeoutMs" in action && typeof action.timeoutMs === "number" && action.timeoutMs > 0
      ? action.timeoutMs
      : DEFAULT_TIMEOUT_MS

  if (action.kind === "shell") return Effect.promise(() => executeCommand(action.command, workspace, timeoutMs))
  if (action.kind === "mcp_tool") {
    return Effect.gen(function* () {
      const caller = yield* McpCaller
      const result = yield* caller.callTool(action.server, action.tool, action.args).pipe(
        Effect.timeout(`${timeoutMs} millis`),
        Effect.catchTags({
          TimeoutException: () => Effect.succeed({ success: false, error: `timeout after ${timeoutMs}ms` }),
          TimeoutError: () => Effect.succeed({ success: false, error: `timeout after ${timeoutMs}ms` }),
        }),
      )
      return { exitCode: result.success ? 0 : 1, error: result.error }
    })
  }
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
  deps: [Database.node, mcpCallerNode],
})
