export * as Tunnel from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import * as NodeChildProcess from "node:child_process"
import type { Readable } from "node:stream"

// Quick, no-account cloudflared tunnel — exposes this server's HTTP port at
// a random https://*.trycloudflare.com URL, which is what a remote webhook
// sender (izapia, or any other waconector provider) needs to reach a
// server otherwise only listening on 127.0.0.1/localhost. See
// AgentUIFormPage's whatsappWebhookUrl for the consumer of this.

export class TunnelError extends Schema.TaggedErrorClass<TunnelError>()("TunnelError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Falha ao iniciar o túnel público: ${this.reason}`
  }
}

export const Status = Schema.Struct({
  running: Schema.Boolean,
  url: Schema.optional(Schema.String),
})
export type Status = Schema.Schema.Type<typeof Status>

export interface Interface {
  readonly start: (input: { port: number }) => Effect.Effect<Status, TunnelError>
  readonly status: () => Effect.Effect<Status>
  readonly stop: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tunnel") {}

// cloudflared prints the assigned URL to stderr, on a line that looks like
// "... |  https://random-two-words.trycloudflare.com  |". stdout carries
// mostly unrelated connection-status logging — checked either way in case
// that changes between versions.
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const START_TIMEOUT_MS = 20_000

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // One tunnel for the whole server process. Every WhatsApp channel on
    // every agent hits the same HTTP listener regardless of which
    // project/directory it's scoped to, so there's never a reason to run
    // more than one at once — starting a second one just reuses whatever
    // is already running (or already starting) instead of spawning again.
    // Not persisted across process restarts: a fresh app launch means a
    // fresh tunnel, and any webhook URL pasted into a provider's dashboard
    // from a previous run goes stale. Acceptable for this phase — flagged
    // here rather than solved, same as the "no directory yet" gaps
    // elsewhere in this feature.
    let child: NodeChildProcess.ChildProcessByStdio<null, Readable, Readable> | undefined
    let url: string | undefined
    let starting: Promise<Status> | undefined

    const reset = () => {
      child = undefined
      url = undefined
      starting = undefined
    }

    const spawnAndWait = (port: number): Promise<Status> =>
      new Promise((resolve, reject) => {
        let proc: NodeChildProcess.ChildProcessByStdio<null, Readable, Readable>
        try {
          proc = NodeChildProcess.spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
            stdio: ["ignore", "pipe", "pipe"],
          })
        } catch (cause) {
          reset()
          reject(new TunnelError({ reason: String(cause) }))
          return
        }
        child = proc

        let settled = false
        const onOutput = (chunk: Buffer) => {
          if (settled) return
          const match = chunk.toString().match(URL_PATTERN)
          if (!match) return
          settled = true
          url = match[0]
          resolve({ running: true, url })
        }
        proc.stdout.on("data", onOutput)
        proc.stderr.on("data", onOutput)
        proc.on("error", (cause) => {
          if (settled) return
          settled = true
          reset()
          reject(new TunnelError({ reason: String(cause) }))
        })
        proc.on("exit", (code) => {
          if (settled) {
            // Process died after we already resolved a URL — clear state
            // so the next start() attempt spawns fresh instead of
            // reporting a tunnel that's actually gone.
            reset()
            return
          }
          settled = true
          reset()
          reject(new TunnelError({ reason: `cloudflared não iniciou instalado ou saiu com código ${code}` }))
        })
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          proc.kill()
          reset()
          reject(new TunnelError({ reason: "tempo esgotado esperando o cloudflared imprimir a URL pública" }))
        }, START_TIMEOUT_MS)
        proc.once("exit", () => clearTimeout(timer))
      })

    const start = Effect.fn("Tunnel.start")(function* (input: { port: number }) {
      if (url) return { running: true, url }
      if (!starting) starting = spawnAndWait(input.port)
      return yield* Effect.tryPromise({
        try: () => starting!,
        catch: (cause) => (cause instanceof TunnelError ? cause : new TunnelError({ reason: String(cause) })),
      })
    })

    const status = Effect.fn("Tunnel.status")(function* () {
      return { running: !!child, url }
    })

    const stop = Effect.fn("Tunnel.stop")(function* () {
      child?.kill()
      reset()
    })

    return Service.of({ start, status, stop })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
