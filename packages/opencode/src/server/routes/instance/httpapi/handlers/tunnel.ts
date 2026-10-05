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

    const startFunnel = Effect.fn("TunnelHttpApi.startFunnel")(function* (ctx: { payload: { port: number } }) {
      return yield* tunnel.startFunnel({ port: ctx.payload.port })
    })

    const stopFunnel = Effect.fn("TunnelHttpApi.stopFunnel")(function* () {
      yield* tunnel.stopFunnel()
      return { ok: true as const }
    })

    return handlers
      .handle("start", start)
      .handle("status", status)
      .handle("stop", stop)
      .handle("tailscale", tailscale)
      .handle("startFunnel", startFunnel)
      .handle("stopFunnel", stopFunnel)
  }),
)
