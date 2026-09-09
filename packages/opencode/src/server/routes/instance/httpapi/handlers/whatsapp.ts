import { WhatsApp } from "@/whatsapp"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const whatsappHandlers = HttpApiBuilder.group(InstanceHttpApi, "whatsapp", (handlers) =>
  Effect.gen(function* () {
    const whatsapp = yield* WhatsApp.Service

    // handleRaw, not handle — the payload shape is whatever JSON the
    // selected provider's webhook posts (no fixed schema across 9
    // providers), and we want direct access to the raw request headers to
    // hand straight to waconector's parser.
    const webhook = Effect.fn("WhatsAppHttpApi.webhook")(function* (ctx: {
      params: { agentId: string; secret: string }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.json)
      const headers: Record<string, string> = { ...ctx.request.headers }
      const result = yield* whatsapp.handleWebhook({
        agentID: ctx.params.agentId,
        secret: ctx.params.secret,
        body,
        headers,
      })
      return HttpServerResponse.jsonUnsafe(result)
    })

    return handlers.handleRaw("webhook", webhook)
  }),
)
