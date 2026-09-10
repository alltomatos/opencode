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

export class WhatsAppProviderApiError extends Schema.TaggedErrorClass<WhatsAppProviderApiError>()(
  "WhatsAppProviderApiError",
  { reason: Schema.String },
) {
  override get message() {
    return `Falha ao consultar a API do provedor de WhatsApp: ${this.reason}`
  }
}

export const IzapiaSession = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.String,
  jid: Schema.optional(Schema.String),
})
export type IzapiaSession = Schema.Schema.Type<typeof IzapiaSession>

export const IzapiaGroup = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  sessionId: Schema.String,
  participantCount: Schema.Number,
})
export type IzapiaGroup = Schema.Schema.Type<typeof IzapiaGroup>

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
  // No "sid" field here on purpose — izapia is multi-session, so which
  // session(s) this channel listens on is `WhatsAppChannelBinding.sessionIds`
  // (picked from the "buscar sessões" list in the form), not a config field.
  izapia: [{ key: "apiKey", required: true, label: "API key do tenant" }],
}

// izapia é SaaS multi-tenant de URL fixa (https://api.izapia.com) — ao
// contrário dos outros providers self-hosted/SaaS acima, não há servidor do
// usuário para apontar, então esse campo nem aparece no form.
const IZAPIA_BASE_URL = "https://api.izapia.com"

// `sidOverride` exists for izapia's multi-session channels: a channel may
// listen on several sessions at once (`channel.sessionIds`), but the
// WaAdapter contract binds to exactly one at construction time — the
// caller picks which one per call (parsing a webhook doesn't care, sending
// a reply must go out through the same session the message arrived on).
function buildAdapter(channel: ConfigAgentUIV1.WhatsAppChannelBinding, sidOverride?: string): WaAdapter {
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
      return izapia({ baseUrl: IZAPIA_BASE_URL, apiKey: cfg.apiKey ?? "", sid: sidOverride ?? channel.sessionIds?.[0] ?? cfg.sid ?? "" })
  }
}

// A group JID (`...@g.us`) is only answered if explicitly allow-listed;
// a direct-message JID (`...@s.whatsapp.net`) or anything else is always
// answered. See ConfigAgentUIV1.WhatsAppChannelBinding.allowedGroups.
function isChatAllowed(channel: ConfigAgentUIV1.WhatsAppChannelBinding, chatId: string): boolean {
  if (!chatId.endsWith("@g.us")) return true
  return (channel.allowedGroups ?? []).includes(chatId)
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
  // Lets the form fetch the tenant's existing WhatsApp sessions (izapia
  // calls them that, not "instances") right after the person pastes their
  // API key, instead of making them go find and copy a sid by hand from
  // the izapia dashboard.
  readonly listIzapiaSessions: (input: { apiKey: string }) => Effect.Effect<IzapiaSession[], WhatsAppProviderApiError>
  // Lets the form fetch the groups each selected session belongs to, so the
  // person can pick exactly which ones this agent should respond in — see
  // ConfigAgentUIV1.WhatsAppChannelBinding.allowedGroups.
  readonly listIzapiaGroups: (input: { apiKey: string; sids: string[] }) => Effect.Effect<IzapiaGroup[], never>
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

      // Parsing itself doesn't depend on which session is bound (see
      // izapia's parseWebhook — no sid in scope), so any configured session
      // works to build the throwaway parsing adapter.
      const parseAdapter = buildAdapter(channel)
      const events = yield* Effect.try({
        try: () => createConnector(parseAdapter).webhooks.parse({ body: input.body, headers: input.headers }),
        catch: (cause) => new WhatsAppInvalidWebhookError({ reason: String(cause) }),
      })

      // Multi-session channels (izapia) share one webhook URL/secret across
      // every configured session — a legacy single-session channel (no
      // `sessionIds` set) trusts whatever session sends to it, same as
      // before this field existed.
      const allowedSessions = channel.sessionIds
      for (const event of events) {
        if (event.type !== "message.received") continue
        if (allowedSessions && event.instanceId && !allowedSessions.includes(event.instanceId)) continue
        if (event.message.fromMe) continue
        if (!isChatAllowed(channel, event.message.chatId)) continue
        const text = event.message.text
        if (!text) continue
        const result = yield* agentUI.dispatchChannelMessage({
          id: input.agentID,
          directory,
          chatKey: event.message.chatId,
          message: text,
        })
        if (result.reply) {
          // Reply through the session the message actually arrived on, not
          // necessarily the first configured one.
          const replyAdapter = buildAdapter(channel, event.instanceId)
          yield* Effect.tryPromise(() =>
            createConnector(replyAdapter).messages.sendText({ to: event.message.chatId, text: result.reply }),
          ).pipe(
            Effect.tapError((cause) => Effect.logError("whatsapp sendText failed", { agentID: input.agentID, cause })),
            Effect.ignore,
          )
        }
      }
      return { ok: true as const }
    })

    // Raw fetch, not the `izapia()` WaAdapter — listing every session for a
    // tenant is an account-level operation (see docs/providers/izapia.md's
    // "Modelo de instância/sessão"), outside the WaAdapter contract, which
    // only ever operates against one already-known `sid`.
    const listIzapiaSessions = Effect.fn("WhatsApp.listIzapiaSessions")(function* (input: { apiKey: string }) {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${IZAPIA_BASE_URL}/api/v1/sessions/`, {
            headers: { authorization: `Bearer ${input.apiKey}` },
          }),
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      if (!response.ok) {
        return yield* new WhatsAppProviderApiError({ reason: `izapia respondeu ${response.status}` })
      }
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
      const list = Array.isArray(body) ? body : Array.isArray(record?.data) ? record.data : undefined
      if (!list) return yield* new WhatsAppProviderApiError({ reason: "resposta inesperada da API do izapia" })
      return list
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? ""),
          name: typeof item.name === "string" && item.name ? item.name : undefined,
          status: String(item.status ?? "unknown"),
          jid: typeof item.jid === "string" ? item.jid : undefined,
        }))
        .filter((session) => session.id)
    })

    // Unlike listIzapiaSessions (account-level, no WaAdapter contract for
    // it), listing a session's groups IS part of the contract
    // (`groups.list`) — reuse the real, already-tested izapia adapter
    // instead of hand-rolling another raw fetch. One session's failure
    // (not yet paired, revoked key, ...) doesn't fail the others; a group
    // that exists on more than one selected session is deduped by id.
    const listIzapiaGroups = Effect.fn("WhatsApp.listIzapiaGroups")(function* (input: {
      apiKey: string
      sids: string[]
    }) {
      const byID = new Map<string, IzapiaGroup>()
      yield* Effect.forEach(
        input.sids,
        (sid) =>
          Effect.tryPromise(() =>
            createConnector(izapia({ baseUrl: IZAPIA_BASE_URL, apiKey: input.apiKey, sid })).groups.list(),
          ).pipe(
            Effect.map((groups) => {
              for (const group of groups) {
                if (byID.has(group.id)) continue
                byID.set(group.id, {
                  id: group.id,
                  subject: group.subject || group.id,
                  sessionId: sid,
                  participantCount: group.participants.length,
                })
              }
            }),
            Effect.tapError((cause) => Effect.logWarning("izapia groups.list failed for session", { sid, cause })),
            Effect.ignore,
          ),
        { concurrency: "unbounded" },
      )
      return Array.from(byID.values())
    })

    return Service.of({ handleWebhook, listIzapiaSessions, listIzapiaGroups })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AgentUI.node],
})
