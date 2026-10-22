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

    const izapiaSessions = Effect.fn("WhatsAppHttpApi.izapiaSessions")(function* (ctx: {
      payload: { apiKey: string }
    }) {
      return yield* whatsapp.listIzapiaSessions({ apiKey: ctx.payload.apiKey })
    })

    const izapiaGroups = Effect.fn("WhatsAppHttpApi.izapiaGroups")(function* (ctx: {
      payload: { apiKey: string; sids: readonly string[] }
    }) {
      return yield* whatsapp.listIzapiaGroups({ apiKey: ctx.payload.apiKey, sids: [...ctx.payload.sids] })
    })

    const izapiaGroupParticipants = Effect.fn("WhatsAppHttpApi.izapiaGroupParticipants")(function* (ctx: {
      payload: { apiKey: string; sid: string; groupId: string }
    }) {
      return yield* whatsapp.listIzapiaGroupParticipants({
        apiKey: ctx.payload.apiKey,
        sid: ctx.payload.sid,
        groupId: ctx.payload.groupId,
      })
    })

    const papiInstances = Effect.fn("WhatsAppHttpApi.papiInstances")(function* (ctx: {
      payload: { token: string }
    }) {
      return yield* whatsapp.listPapiInstances({ token: ctx.payload.token })
    })

    const papiCreateInstance = Effect.fn("WhatsAppHttpApi.papiCreateInstance")(function* (ctx: {
      payload: { token: string; instanceName: string }
    }) {
      return yield* whatsapp.createPapiInstance({ token: ctx.payload.token, instanceName: ctx.payload.instanceName })
    })

    const papiSetupWebhook = Effect.fn("WhatsAppHttpApi.papiSetupWebhook")(function* (ctx: {
      payload: { token: string; instanceId: string; webhookUrl: string }
    }) {
      return yield* whatsapp.setupPapiWebhook({
        token: ctx.payload.token,
        instanceId: ctx.payload.instanceId,
        webhookUrl: ctx.payload.webhookUrl,
      })
    })

    const papiGroups = Effect.fn("WhatsAppHttpApi.papiGroups")(function* (ctx: {
      payload: { token: string; instanceIds: readonly string[] }
    }) {
      return yield* whatsapp.listPapiGroups({ token: ctx.payload.token, instanceIds: ctx.payload.instanceIds })
    })

    return handlers
      .handleRaw("webhook", webhook)
      .handle("izapiaSessions", izapiaSessions)
      .handle("izapiaGroups", izapiaGroups)
      .handle("izapiaGroupParticipants", izapiaGroupParticipants)
      .handle("papiInstances", papiInstances)
      .handle("papiCreateInstance", papiCreateInstance)
      .handle("papiSetupWebhook", papiSetupWebhook)
      .handle("papiGroups", papiGroups)
  }),
)
