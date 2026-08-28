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
import * as NodeChildProcess from "node:child_process"

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
  readonly env?: Readonly<Record<string, string>>
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
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  buffer: string
}

export type SessionInfo = {
  readonly handle: Handle
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly pid: number
}

export type Attachment = {
  // The output already buffered before this attach — send it to the client once, then rely
  // on the onData callback for everything after (no cursor/replay-cursor protocol needed:
  // one process only ever has one live viewer's worth of state to catch up on).
  readonly replay: string
  readonly write: (data: string) => void
  readonly dispose: () => void
}

export interface Interface {
  readonly spawn: (input: SpawnInput) => Effect.Effect<Handle, SpawnFailedError>
  readonly send: (handle: Handle, text: string) => Effect.Effect<void, NotFoundError>
  readonly waitIdle: (handle: Handle, opts?: WaitIdleInput) => Effect.Effect<string, NotFoundError>
  readonly kill: (handle: Handle) => Effect.Effect<void>
  readonly list: () => Effect.Effect<readonly SessionInfo[]>
  readonly attach: (handle: Handle, onData: (chunk: string) => void) => Effect.Effect<Attachment, NotFoundError>
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
            ...(input.env ? { env: { ...process.env, ...input.env } as Record<string, string> } : {}),
          }),
        catch: (e) => new SpawnFailedError({ message: e instanceof Error ? e.message : String(e) }),
      })
      const session: Active = { proc, command: input.command, args: input.args ?? [], cwd: input.cwd, buffer: "" }
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
      sessions.delete(handle)
      // On Windows, ConPTY's kill() only signals the pty's own process — it leaves
      // any child processes spawned under it (and their handles) running, which
      // pins the host event loop open. taskkill /T walks the whole process tree.
      if (process.platform === "win32") {
        yield* Effect.callback<void>((resume) => {
          NodeChildProcess.exec(`taskkill /pid ${session.proc.pid} /T /F`, { windowsHide: true }, () => {
            resume(Effect.void)
          })
        })
      }
      try {
        session.proc.kill()
      } catch {}
    })

    const list = Effect.fn("ExternalAgent.list")(function* () {
      return Array.from(sessions.entries(), ([handle, session]) => ({
        handle,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        pid: session.proc.pid,
      }))
    })

    // Streams output to a caller-supplied sink from the moment of attach; the already-buffered
    // output is returned once as `replay` so the client can render what it missed without a
    // cursor protocol. Only one viewer is expected at a time (the live-terminal panel), so no
    // fan-out bookkeeping beyond the single onData subscription.
    const attach = Effect.fn("ExternalAgent.attach")(function* (handle: Handle, onData: (chunk: string) => void) {
      const session = sessions.get(handle)
      if (!session) return yield* new NotFoundError({ handle })
      const disp = session.proc.onData(onData)
      return {
        replay: session.buffer,
        write: (data: string) => session.proc.write(data),
        dispose: () => disp.dispose(),
      }
    })

    return Service.of({ spawn, send, waitIdle, kill, list, attach })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as ExternalAgent from "."
