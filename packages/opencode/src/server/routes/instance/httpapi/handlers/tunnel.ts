import { Tunnel } from "@/tunnel"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const tunnelHandlers = HttpApiBuilder.group(InstanceHttpApi, "tunnel", (handlers) =>
  Effect.gen(function* () {
    const tunnel = yield* Tunnel.Service

    const start = Effect.fn("TunnelHttpApi.start")(function* (ctx: { payload: { port: number } }) {
      return yield* tunnel.start({ port: ctx.payload.port })
    })

    const status = Effect.fn("TunnelHttpApi.status")(function* () {
      return yield* tunnel.status()
    })

    const stop = Effect.fn("TunnelHttpApi.stop")(function* () {
      yield* tunnel.stop()
      return { ok: true as const }
    })

    const tailscale = Effect.fn("TunnelHttpApi.tailscale")(function* () {
      return yield* tunnel.tailscale()
    })

    return handlers.handle("start", start).handle("status", status).handle("stop", stop).handle("tailscale", tailscale)
  }),
)
