import { detectExternalAgents } from "@opencode-ai/core/external-agent-detect"
import { KNOWN_EXTERNAL_AGENTS } from "@opencode-ai/core/external-agent-registry"
import { installBatutaCliSkill, removeBatutaCliSkill } from "@opencode-ai/core/external-agent-skill"
import { Global } from "@opencode-ai/core/global"
import { ExternalAgent, type Handle } from "@/external-agent"
import { ExternalAgentTicket } from "@/external-agent/ticket"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Effect, Queue } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { CorsConfig, isAllowedRequestOrigin, type CorsOptions } from "@opencode-ai/server/cors"
import { PTY_CONNECT_TICKET_QUERY, PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE } from "@/server/shared/pty-ticket"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"
import { ExternalAgentConnectApi } from "../groups/external-agent"
import { WebSocketTracker } from "../websocket-tracker"

function validOrigin(request: HttpServerRequest.HttpServerRequest, opts: CorsOptions | undefined) {
  return isAllowedRequestOrigin(request.headers.origin, request.headers.host, opts)
}

const ticketScope = Effect.gen(function* () {
  const instance = yield* InstanceRef
  const workspaceID = yield* WorkspaceRef
  return { directory: instance?.directory, workspaceID }
})

export const externalAgentHandlers = HttpApiBuilder.group(InstanceHttpApi, "externalAgent", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* ExternalAgent.Service
    const tickets = yield* ExternalAgentTicket.Service
    const cors = yield* CorsConfig

    const detect = Effect.fn("ExternalAgentHttpApi.detect")(function* () {
      return yield* Effect.promise(() => detectExternalAgents())
    })

    const setSkill = Effect.fn("ExternalAgentHttpApi.setSkill")(function* (ctx: {
      params: { id: string }
      payload: { install: boolean }
    }) {
      const known = KNOWN_EXTERNAL_AGENTS.find((entry) => entry.id === ctx.params.id)
      if (!known) return { installed: false }
      yield* Effect.promise(() =>
        ctx.payload.install
          ? installBatutaCliSkill(known, Global.Path.home)
          : removeBatutaCliSkill(known, Global.Path.home),
      )
      return { installed: ctx.payload.install }
    })

    const listSessions = Effect.fn("ExternalAgentHttpApi.listSessions")(function* () {
      return yield* agent.list()
    })

    const connectToken = Effect.fn("ExternalAgentHttpApi.connectToken")(function* (ctx: {
      params: { handle: string }
    }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(request, cors))
        return yield* new ApiError.ExternalAgentForbiddenError({ message: "Invalid connect token request" })
      const sessions = yield* agent.list()
      const handle = ctx.params.handle as Handle
      if (!sessions.some((session) => session.handle === handle))
        return yield* new ApiError.ExternalAgentSessionNotFoundError({
          handle: ctx.params.handle,
          message: `External agent session not found: ${ctx.params.handle}`,
        })
      return yield* tickets.issue({ handle, ...(yield* ticketScope) })
    })

    return handlers
      .handle("detect", detect)
      .handle("setSkill", setSkill)
      .handle("listSessions", listSessions)
      .handle("connectToken", connectToken)
  }),
)

export const externalAgentConnectHandlers = HttpApiBuilder.group(
  ExternalAgentConnectApi,
  "externalAgent-connect",
  (handlers) =>
    Effect.gen(function* () {
      const agent = yield* ExternalAgent.Service
      const tickets = yield* ExternalAgentTicket.Service
      const cors = yield* CorsConfig

      return handlers.handleRaw(
        "connect",
        Effect.fn("ExternalAgentHttpApi.connect")(function* (ctx: {
          params: { handle: string }
          request: HttpServerRequest.HttpServerRequest
        }) {
          const handle = ctx.params.handle as Handle
          const exists = yield* agent.list().pipe(Effect.map((sessions) => sessions.some((s) => s.handle === handle)))
          if (!exists) return HttpServerResponse.empty({ status: 404 })

          const ticket = new URL(ctx.request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)
          if (ticket) {
            const valid = validOrigin(ctx.request, cors)
              ? yield* tickets.consume({ ticket, handle, ...(yield* ticketScope) })
              : false
            if (!valid) return HttpServerResponse.empty({ status: 403 })
          }

          const socket = yield* Effect.orDie(ctx.request.upgrade)
          const write = yield* socket.writer
          const closeAccepted = (event: Socket.CloseEvent) =>
            socket
              .runRaw(() => Effect.void, { onOpen: write(event).pipe(Effect.catch(() => Effect.void)) })
              .pipe(
                Effect.timeout("1 second"),
                Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
                Effect.catch(() => Effect.void),
              )
          const registered = yield* WebSocketTracker.register(write(WebSocketTracker.SERVER_CLOSING_EVENT()))
          if (!registered) {
            yield* closeAccepted(WebSocketTracker.SERVER_CLOSING_EVENT())
            return HttpServerResponse.empty()
          }

          // Outbound frames flow through one queue drained by a single writer so replay
          // and live output keep their order — same shape as PtyHttpApi.connect, but this
          // wire protocol is plain UTF-8 text (no cursor/replay-cursor framing): one
          // process only ever has one live viewer's worth of state to catch up on.
          const outbox = yield* Queue.unbounded<string | Socket.CloseEvent>()
          const attachment = yield* agent.attach(handle, (chunk) => Queue.offerUnsafe(outbox, chunk)).pipe(
            Effect.catchTag("ExternalAgentNotFoundError", () =>
              closeAccepted(new Socket.CloseEvent(4404, "session not found")).pipe(Effect.as(undefined)),
            ),
          )
          if (!attachment) return HttpServerResponse.empty()

          if (attachment.replay) Queue.offerUnsafe(outbox, attachment.replay)

          const drain = Effect.gen(function* () {
            while (true) {
              const item = yield* Queue.take(outbox)
              yield* write(item)
              if (item instanceof Socket.CloseEvent) return
            }
          })

          yield* Effect.race(
            drain,
            socket.runRaw((message) => {
              attachment.write(typeof message === "string" ? message : new TextDecoder().decode(message))
            }),
          ).pipe(
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.ensuring(Effect.sync(() => attachment.dispose())),
            Effect.orDie,
          )
          return HttpServerResponse.empty()
        }),
      )
    }),
)
