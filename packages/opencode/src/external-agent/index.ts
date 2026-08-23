import { LayerNode } from "@opencode-ai/core/effect/layer-node"
// This must resolve conditionally: the "bun" variant statically imports "bun-pty", which
// itself imports "bun:ffi". Under Node (e.g. this file's dist/node build, loaded by
// Electron's Node-based main/utility process) an eager `bun:`-scheme import crashes with
// ERR_UNSUPPORTED_ESM_URL_SCHEME even if never actually invoked, since ESM imports are
// resolved eagerly. See @opencode-ai/core's package.json "exports"/"./pty/runtime" and
// packages/opencode/script/build-node.ts's `conditions: ["node"]`.
import { spawn as ptySpawn } from "@opencode-ai/core/pty/runtime"
import type { Proc } from "@opencode-ai/core/pty/pty"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * Minimal terminal-automation layer for Batuta V2 external workers (claude,
 * codex, ...): spawn a third-party agent CLI in a real PTY inside a worktree,
 * feed it a prompt, and wait for it to go quiet ("idle") the way the Orca
 * orchestrator does — there's no structured protocol to talk to these CLIs,
 * so idle detection is a silence heuristic, not a real turn-completion signal.
 */

export class SpawnFailedError extends Schema.TaggedErrorClass<SpawnFailedError>()("ExternalAgentSpawnFailedError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ExternalAgentNotFoundError", {
  handle: Schema.String,
}) {}

export type Handle = string & { readonly __externalAgentHandle: unique symbol }

export type SpawnInput = {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd: string
}

export type WaitIdleInput = {
  // How long the PTY must stay silent before its output is considered a finished turn.
  readonly idleMs?: number
  // Safety net in case the CLI never goes idle (stuck, waiting on unexpected input, etc).
  readonly timeoutMs?: number
}

const DEFAULT_IDLE_MS = 1_500
const DEFAULT_TIMEOUT_MS = 5 * 60_000

type Active = {
  readonly proc: Proc
  buffer: string
}

export interface Interface {
  readonly spawn: (input: SpawnInput) => Effect.Effect<Handle, SpawnFailedError>
  readonly send: (handle: Handle, text: string) => Effect.Effect<void, NotFoundError>
  readonly waitIdle: (handle: Handle, opts?: WaitIdleInput) => Effect.Effect<string, NotFoundError>
  readonly kill: (handle: Handle) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExternalAgent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = new Map<Handle, Active>()
    let counter = 0

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const session of sessions.values()) {
          try {
            session.proc.kill()
          } catch {}
        }
        sessions.clear()
      }),
    )

    const spawn = Effect.fn("ExternalAgent.spawn")(function* (input: SpawnInput) {
      const handle = `ext_${++counter}_${Date.now()}` as Handle
      const proc = yield* Effect.try({
        try: () =>
          ptySpawn(input.command, [...(input.args ?? [])], {
            name: "xterm-256color",
            cwd: input.cwd,
          }),
        catch: (e) => new SpawnFailedError({ message: e instanceof Error ? e.message : String(e) }),
      })
      const session: Active = { proc, buffer: "" }
      sessions.set(handle, session)
      proc.onData((chunk) => {
        session.buffer += chunk
      })
      return handle
    })

    const send = Effect.fn("ExternalAgent.send")(function* (handle: Handle, text: string) {
      const session = sessions.get(handle)
      if (!session) return yield* new NotFoundError({ handle })
      session.proc.write(text.endsWith("\r") ? text : `${text}\r`)
    })

    const waitIdle = Effect.fn("ExternalAgent.waitIdle")(function* (handle: Handle, opts?: WaitIdleInput) {
      const session = sessions.get(handle)
      if (!session) return yield* new NotFoundError({ handle })
      const idleMs = opts?.idleMs ?? DEFAULT_IDLE_MS
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

      return yield* Effect.callback<string>((resume) => {
        let idleTimer: ReturnType<typeof setTimeout> | undefined
        let settled = false

        const armIdle = () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(finish, idleMs)
        }

        const dataDisp = session.proc.onData(armIdle)
        const exitDisp = session.proc.onExit(finish)
        const overallTimer = setTimeout(finish, timeoutMs)

        function finish() {
          if (settled) return
          settled = true
          if (idleTimer) clearTimeout(idleTimer)
          clearTimeout(overallTimer)
          dataDisp.dispose()
          exitDisp.dispose()
          resume(Effect.succeed(session!.buffer))
        }

        armIdle()

        return Effect.sync(() => {
          if (settled) return
          settled = true
          if (idleTimer) clearTimeout(idleTimer)
          clearTimeout(overallTimer)
          dataDisp.dispose()
          exitDisp.dispose()
        })
      })
    })

    const kill = Effect.fn("ExternalAgent.kill")(function* (handle: Handle) {
      const session = sessions.get(handle)
      if (!session) return
      try {
        session.proc.kill()
      } catch {}
      sessions.delete(handle)
    })

    return Service.of({ spawn, send, waitIdle, kill })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as ExternalAgent from "."
