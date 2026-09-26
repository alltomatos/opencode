export * as ScheduleRunner from "./runner"

import { spawn } from "node:child_process"
import { Context, Duration, Effect, Layer, Schema, Schedule as EffectSchedule } from "effect"
import { Schedule } from "../schedule"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Schedule.NotFoundError", {
  id: Schedule.ID,
}) {}

export interface SkillCallResult {
  readonly success: boolean
  readonly error?: string
  readonly sessionId?: string
}

export interface SkillCallerInterface {
  readonly runSkill: (
    action: Schedule.SkillAction,
    workspace: string | undefined,
    sessionId?: string,
  ) => Effect.Effect<SkillCallResult>
}

export class SkillCaller extends Context.Service<SkillCaller, SkillCallerInterface>()("@opencode/v2/Schedule/SkillCaller") {}

const skillCallerUnsupportedLayer = Layer.succeed(
  SkillCaller,
  SkillCaller.of({
    runSkill: () =>
      Effect.succeed({
        success: false,
        error: "Skill/AI actions require the OpenCode runtime session, not available in this standalone server process.",
      }),
  }),
)

export const skillCallerNode = makeGlobalNode({ service: SkillCaller, layer: skillCallerUnsupportedLayer, deps: [] })

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
function runAction(action: Schedule.Action, workspace: string | undefined, sessionId?: string) {
  const timeoutMs =
    "timeoutMs" in action && typeof action.timeoutMs === "number" && action.timeoutMs > 0
      ? action.timeoutMs
      : DEFAULT_TIMEOUT_MS

  if (action.kind === "shell") {
    return Effect.promise(() => executeCommand(action.command, workspace, timeoutMs)).pipe(
      Effect.map((res) => ({ exitCode: res.exitCode, error: res.error, sessionId: undefined })),
    )
  }
  if (action.kind === "mcp_tool") {
    return Effect.gen(function* () {
      const caller = yield* McpCaller
      const result: McpCallResult = yield* caller.callTool(action.server, action.tool, action.args).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () => Effect.succeed({ success: false, error: `timeout after ${timeoutMs}ms` }),
        }),
      )
      return { exitCode: result.success ? 0 : 1, error: result.error, sessionId: undefined }
    })
  }
  if (action.kind === "skill") {
    return Effect.gen(function* () {
      const caller = yield* SkillCaller
      const result: SkillCallResult = yield* caller.runSkill(action, workspace, sessionId).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () => Effect.succeed({ success: false, error: `timeout after ${timeoutMs}ms` }),
        }),
      )
      return { exitCode: result.success ? 0 : 1, error: result.error, sessionId: result.sessionId }
    })
  }
  return Effect.succeed({
    exitCode: 1,
    error: `Action kind "${(action as any).kind}" is not yet supported by the schedule runner.`,
    sessionId: undefined,
  })
}

/** Executes an action directly as a dry-run test/validation without needing a saved Schedule ID */
export const testAction = Effect.fn("v2.Schedule.testAction")(function* (
  action: Schedule.Action,
  workspace?: string,
) {
  const result = yield* runAction(action, workspace)
  return {
    success: result.exitCode === 0,
    error: result.error,
    sessionId: result.sessionId,
  }
})

/** Runs one schedule's action immediately, regardless of trigger/enabled state, and records the result. */
export const runOne = Effect.fn("v2.Schedule.runOne")(function* (id: Schedule.ID) {
  const schedules = yield* Schedule.Service
  const schedule = yield* schedules.get(id)
  if (!schedule) return yield* Effect.fail(new NotFoundError({ id }))

  const result = yield* runAction(schedule.action, schedule.workspace, schedule.lastSessionId)
  const updated = yield* schedules.update(schedule.id, {
    lastRunAt: Date.now(),
    lastStatus: result.exitCode === 0 ? "success" : "error",
    lastError: result.error,
    lastSessionId: result.sessionId ?? schedule.lastSessionId,
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

    const result = yield* runAction(schedule.action, schedule.workspace, schedule.lastSessionId)
    yield* schedules.update(schedule.id, {
      lastRunAt: nowMs,
      lastStatus: result.exitCode === 0 ? "success" : "error",
      lastError: result.error,
      lastSessionId: result.sessionId ?? schedule.lastSessionId,
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
  deps: [Database.node, mcpCallerNode, skillCallerNode],
})
