export * as WhatsApp from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { AgentUI, AgentUINotFoundError } from "@/agentui"
import { Context, Effect, Layer, Schema } from "effect"
import { createConnector, type WaAdapter } from "waconector"
import { waha } from "waconector/waha"
import { evolution } from "waconector/evolution"
import { zapi } from "waconector/zapi"
import { uazapi } from "waconector/uazapi"
import { whapi } from "waconector/whapi"
import { wuzapi } from "waconector/wuzapi"
import { quepasa } from "waconector/quepasa"
import { wppconnect } from "waconector/wppconnect"
import { izapia } from "waconector/izapia"

// Phase 2 of "Canais" (Channels) for AgentUI (#144 follow-up) — WhatsApp via
// waconector (https://alltomatos.github.io/waconector/), which wraps 9
// unofficial WhatsApp APIs (5 self-hosted, 4 SaaS/private) behind one
// contract. Unlike Telegram (long-poll — see Telegram.Service), waconector
// is webhook-only: every provider calls US, so this service is a webhook
// receiver, not a poll loop. See groups/handlers/whatsapp.ts for the
// (deliberately unauthenticated, secret-in-URL-protected) HTTP route.

export class WhatsAppChannelNotConfiguredError extends Schema.TaggedErrorClass<WhatsAppChannelNotConfiguredError>()(
  "WhatsAppChannelNotConfiguredError",
  { id: Schema.String },
) {
  override get message() {
    return `Este agente não tem canal WhatsApp configurado: ${this.id}`
  }
}

export class WhatsAppInvalidWebhookError extends Schema.TaggedErrorClass<WhatsAppInvalidWebhookError>()(
  "WhatsAppInvalidWebhookError",
  { reason: Schema.String },
) {
  override get message() {
    return `Webhook do WhatsApp inválido: ${this.reason}`
  }
}

export interface ProviderField {
  readonly key: string
  readonly required: boolean
  readonly label: string
}

// Sourced directly from each adapter's shipped .d.ts (packages/opencode
// depends on the real `waconector` package — these are NOT guesses from the
// docs site, which uses different factory names/fields than the actual
// package). Only the fields needed to actually connect are listed here —
// advanced per-adapter tuning (timeoutMs, retries, subscribe[], ...) is out
// of scope for this phase's UI.
export const PROVIDER_FIELDS: Record<ConfigAgentUIV1.WhatsAppProvider, readonly ProviderField[]> = {
  waha: [
    { key: "baseUrl", required: true, label: "URL base (ex.: http://localhost:3000)" },
    { key: "apiKey", required: true, label: "API Key (X-Api-Key)" },
    { key: "session", required: false, label: "Nome da sessão (padrão: default)" },
  ],
  evolution: [
    { key: "baseUrl", required: true, label: "URL base do servidor Evolution GO" },
    { key: "apiKey", required: true, label: "API Key da instância" },
  ],
  zapi: [
    { key: "instanceId", required: true, label: "Instance ID" },
    { key: "token", required: true, label: "Token da instância" },
    { key: "clientToken", required: false, label: "Client-Token (se ativado na conta)" },
  ],
  uazapi: [
    { key: "baseUrl", required: true, label: "URL base (ex.: https://minhaempresa.uazapi.com)" },
    { key: "token", required: true, label: "Token da instância" },
  ],
  whapi: [{ key: "token", required: true, label: "Token do canal (Bearer)" }],
  wuzapi: [
    { key: "baseUrl", required: true, label: "URL base do servidor Wuzapi" },
    { key: "token", required: true, label: "Token do usuário" },
  ],
  quepasa: [
    { key: "baseUrl", required: true, label: "URL base da instância QuePasa" },
    { key: "token", required: true, label: "Token da instância" },
  ],
  wppconnect: [
    { key: "baseUrl", required: true, label: "URL base do servidor WPPConnect" },
    { key: "session", required: true, label: "Nome da sessão" },
    { key: "token", required: true, label: "Token Bearer da sessão" },
  ],
  izapia: [
    { key: "baseUrl", required: true, label: "URL base (ex.: https://api.izapia.com)" },
    { key: "apiKey", required: true, label: "API key do tenant" },
    { key: "sid", required: true, label: "ID de uma sessão já criada" },
  ],
}

function buildAdapter(channel: ConfigAgentUIV1.WhatsAppChannelBinding): WaAdapter {
  const cfg = channel.config
  switch (channel.provider) {
    case "waha":
      return waha({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey ?? "", session: cfg.session })
    case "evolution":
      return evolution({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey ?? "" })
    case "zapi":
      return zapi({ instanceId: cfg.instanceId ?? "", token: cfg.token ?? "", clientToken: cfg.clientToken })
    case "uazapi":
      return uazapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "" })
    case "whapi":
      return whapi({ token: cfg.token ?? "" })
    case "wuzapi":
      return wuzapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "" })
    case "quepasa":
      return quepasa({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "" })
    case "wppconnect":
      return wppconnect({ baseUrl: cfg.baseUrl ?? "", session: cfg.session ?? "", token: cfg.token ?? "" })
    case "izapia":
      return izapia({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey ?? "", sid: cfg.sid ?? "" })
  }
}

function findChannel(agent: ConfigAgentUIV1.Agent): ConfigAgentUIV1.WhatsAppChannelBinding | undefined {
  return agent.channels.find((c): c is ConfigAgentUIV1.WhatsAppChannelBinding => c.type === "whatsapp")
}

export interface Interface {
  readonly handleWebhook: (input: {
    agentID: string
    secret: string
    body: unknown
    headers: Record<string, string>
  }) => Effect.Effect<{ ok: true }, AgentUINotFoundError | WhatsAppChannelNotConfiguredError | WhatsAppInvalidWebhookError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WhatsApp") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agentUI = yield* AgentUI.Service

    const handleWebhook = Effect.fn("WhatsApp.handleWebhook")(function* (input: {
      agentID: string
      secret: string
      body: unknown
      headers: Record<string, string>
    }) {
      const agent = yield* agentUI.get(input.agentID)
      const channel = findChannel(agent)
      if (!channel) return yield* new WhatsAppChannelNotConfiguredError({ id: input.agentID })
      if (channel.webhookSecret !== input.secret) {
        return yield* new WhatsAppInvalidWebhookError({ reason: "secret mismatch" })
      }
      // Silently drop (not an error — the provider must still get a 200 or
      // it will keep retrying/backing off) rather than dispatch to a
      // disabled agent or one missing the directory it needs to run a
      // session against.
      if (!ConfigAgentUIV1.isEnabled(agent) || !channel.directory) return { ok: true as const }
      const directory = channel.directory

      const adapter = buildAdapter(channel)
      const connector = createConnector(adapter)
      const events = yield* Effect.try({
        try: () => connector.webhooks.parse({ body: input.body, headers: input.headers }),
        catch: (cause) => new WhatsAppInvalidWebhookError({ reason: String(cause) }),
      })

      for (const event of events) {
        if (event.type !== "message.received") continue
        if (event.message.fromMe) continue
        const text = event.message.text
        if (!text) continue
        const result = yield* agentUI.dispatchChannelMessage({
          id: input.agentID,
          directory,
          chatKey: event.message.chatId,
          message: text,
        })
        if (result.reply) {
          yield* Effect.tryPromise(() => connector.messages.sendText({ to: event.message.chatId, text: result.reply })).pipe(
            Effect.tapError((cause) => Effect.logError("whatsapp sendText failed", { agentID: input.agentID, cause })),
            Effect.ignore,
          )
        }
      }
      return { ok: true as const }
    })

    return Service.of({ handleWebhook })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AgentUI.node],
})
