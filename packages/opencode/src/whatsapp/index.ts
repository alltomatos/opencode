export * as WhatsApp from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { AgentUI } from "@/agentui"
import { Context, Duration, Effect, Fiber, Layer, Schedule, Schema, Scope } from "effect"
import { createConnector, type WaAdapter, type WaMessage } from "waconector"
import { waha } from "waconector/waha"
import { evolution } from "waconector/evolution"
import { zapi } from "waconector/zapi"
import { uazapi } from "waconector/uazapi"
import { whapi } from "waconector/whapi"
import { wuzapi } from "waconector/wuzapi"
import { quepasa } from "waconector/quepasa"
import { wppconnect } from "waconector/wppconnect"
import { izapia } from "waconector/izapia"

// Typed errors for the HttpApi handler layer.
export class WhatsAppChannelNotConfiguredError extends Schema.TaggedErrorClass<WhatsAppChannelNotConfiguredError>()(
  "WhatsAppChannelNotConfiguredError",
  { id: Schema.String },
) {
  override get message() {
    return `Canal WhatsApp não configurado para o agente: ${this.id}`
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
    return `Falha na API do provedor de WhatsApp: ${this.reason}`
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

// izapia is multi-tenant / multi-session: its API base is fixed across all
// accounts (unlike self-hosted WAHA/Evolution which need a user-provided
// baseUrl).
const IZAPIA_BASE_URL = "https://api.izapia.com"

function buildAdapter(channel: ConfigAgentUIV1.WhatsAppChannelBinding, sidOverride?: string): WaAdapter {
  const cfg = channel.config
  switch (channel.provider) {
    case "waha":
      return waha({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey, session: sidOverride ?? cfg.session })
    case "evolution":
      return evolution({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey ?? "", instance: sidOverride ?? cfg.instance ?? cfg.instanceName ?? "" })
    case "zapi":
      return zapi({ instanceId: sidOverride ?? cfg.instanceId ?? "", token: cfg.token ?? "", clientToken: cfg.clientToken })
    case "uazapi":
      return uazapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "", adminToken: cfg.adminToken })
    case "whapi":
      return whapi({ token: cfg.token ?? "" })
    case "wuzapi":
      return wuzapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? cfg.userToken ?? "" })
    case "quepasa":
      return quepasa({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "" })
    case "wppconnect":
      return wppconnect({ baseUrl: cfg.baseUrl ?? "", session: sidOverride ?? cfg.session ?? "", token: cfg.token ?? cfg.secretKey ?? "" })
    case "izapia":
      return izapia({
        baseUrl: cfg.baseUrl || IZAPIA_BASE_URL,
        apiKey: cfg.apiKey ?? "",
        sid: sidOverride || channel.sessionIds?.[0] || cfg.sid || "",
      })
  }
}

function findChannel(agent: ConfigAgentUIV1.Agent): ConfigAgentUIV1.WhatsAppChannelBinding | undefined {
  const found = agent.channels.find((c) => c.type === "whatsapp")
  return found && found.type === "whatsapp" ? found : undefined
}

function isChatAllowed(channel: ConfigAgentUIV1.WhatsAppChannelBinding, chatId: string): boolean {
  if (!chatId.endsWith("@g.us")) return true
  const allowed = channel.allowedGroups
  return Array.isArray(allowed) && allowed.includes(chatId)
}

export interface Interface {
  readonly handleWebhook: (input: {
    agentID: string
    secret: string
    body: unknown
    headers: Record<string, string>
  }) => Effect.Effect<
    { ok: true },
    WhatsAppChannelNotConfiguredError | WhatsAppInvalidWebhookError | AgentUI.AgentUINotFoundError
  >
  readonly listIzapiaSessions: (input: {
    apiKey: string
  }) => Effect.Effect<{ id: string; name?: string; status: string; jid?: string }[], WhatsAppProviderApiError>
  readonly listIzapiaGroups: (input: { apiKey: string; sids: string[] }) => Effect.Effect<IzapiaGroup[], never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WhatsApp") {}

// 7 segundos de janela de debounce para acumular mensagens sequenciais curtas
// enviadas por pessoas antes do agente formular a resposta única.
const DEBOUNCE = Duration.seconds(7)

interface WhatsAppAttachment {
  filename?: string
  mime: string
  url: string
}

interface PendingBatch {
  texts: string[]
  attachments: WhatsAppAttachment[]
  fiber: Fiber.Fiber<void, never>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agentUI = yield* AgentUI.Service
    const scope = yield* Scope.Scope
    const pending = new Map<string, PendingBatch>()
    // Deduplicação de mensagens recebidas por ID para evitar processamento duplicado
    const processedMessageIds = new Set<string>()

    const setTyping = (channel: ConfigAgentUIV1.WhatsAppChannelBinding, sid: string | undefined, to: string) =>
      Effect.gen(function* () {
        const connector = createConnector(buildAdapter(channel, sid))
        const setter = connector.presence?.setTyping
        if (!setter) return
        yield* Effect.tryPromise(() => setter({ to, state: "composing" }))
      }).pipe(Effect.ignore)

    const flushBatch = (input: {
      agentID: string
      directory: string
      channel: ConfigAgentUIV1.WhatsAppChannelBinding
      chatId: string
      instanceId: string | undefined
      key: string
    }) =>
      Effect.gen(function* () {
        const batch = pending.get(input.key)
        pending.delete(input.key)
        if (!batch) return
        yield* setTyping(input.channel, input.instanceId, input.chatId)
        const result = yield* agentUI.dispatchChannelMessage({
          id: input.agentID,
          directory: input.directory,
          chatKey: input.chatId,
          message: batch.texts.join("\n"),
          attachments: batch.attachments.length > 0 ? batch.attachments : undefined,
        })
        if (!result.reply) return
        const replyAdapter = buildAdapter(input.channel, input.instanceId)
        yield* Effect.tryPromise(() =>
          createConnector(replyAdapter).messages.sendText({ to: input.chatId, text: result.reply }),
        ).pipe(
          Effect.retry({ schedule: Schedule.exponential("2 seconds").pipe(Schedule.both(Schedule.recurs(4))) }),
          Effect.tapError((cause) => Effect.logError("whatsapp sendText failed", { agentID: input.agentID, cause })),
          Effect.ignore,
        )
      })

    const enqueue = (input: {
      agentID: string
      directory: string
      channel: ConfigAgentUIV1.WhatsAppChannelBinding
      chatId: string
      instanceId: string | undefined
      text?: string
      attachments?: WhatsAppAttachment[]
    }) =>
      Effect.gen(function* () {
        const key = `${input.agentID}:${input.chatId}`
        const existing = pending.get(key)
        if (existing) yield* Fiber.interrupt(existing.fiber)
        const texts = input.text ? [...(existing?.texts ?? []), input.text] : (existing?.texts ?? [])
        const attachments = input.attachments
          ? [...(existing?.attachments ?? []), ...input.attachments]
          : (existing?.attachments ?? [])

        const fiber = yield* Effect.sleep(DEBOUNCE)
          .pipe(
            Effect.andThen(() =>
              flushBatch({
                agentID: input.agentID,
                directory: input.directory,
                channel: input.channel,
                chatId: input.chatId,
                instanceId: input.instanceId,
                key,
              }),
            ),
          )
          .pipe(Effect.ignore, Effect.forkIn(scope))
        pending.set(key, { texts, attachments, fiber })
      })

    const extractMediaAttachment = (
      adapter: WaAdapter,
      msg: WaMessage,
    ): Effect.Effect<WhatsAppAttachment | undefined> =>
      Effect.gen(function* () {
        if (!msg.media) return undefined
        const media = msg.media
        if (media.base64) {
          const mime = media.mimeType || "application/octet-stream"
          return {
            filename: media.filename || `anexo_${Date.now()}`,
            mime,
            url: `data:${mime};base64,${media.base64}`,
          }
        }
        if (media.url && media.url.startsWith("http")) {
          // Tenta baixar a URL caso o provedor exponha link público ou temporário
          const res = yield* Effect.tryPromise(() => fetch(media.url!)).pipe(Effect.option)
          if (res._tag === "Some" && res.value.ok) {
            const buf = yield* Effect.promise(() => res.value.arrayBuffer())
            const mime = media.mimeType || res.value.headers.get("content-type") || "application/octet-stream"
            return {
              filename: media.filename || `anexo_${Date.now()}`,
              mime,
              url: `data:${mime};base64,${Buffer.from(buf).toString("base64")}`,
            }
          }
        }

        // Tenta baixar via connector.messages.download caso o provedor suporte
        const connector = createConnector(adapter)
        const downloaded = yield* Effect.tryPromise(() =>
          connector.messages.download({ messageId: msg.id, raw: msg.raw }),
        ).pipe(Effect.option)

        if (downloaded._tag === "Some" && downloaded.value.base64) {
          const mime = downloaded.value.mimeType || media.mimeType || "application/octet-stream"
          return {
            filename: downloaded.value.filename || media.filename || `anexo_${Date.now()}`,
            mime,
            url: `data:${mime};base64,${downloaded.value.base64}`,
          }
        }

        return undefined
      })

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
      if (!ConfigAgentUIV1.isEnabled(agent)) return { ok: true as const }
      const directory = channel.directory || process.cwd()

      const parseAdapter = buildAdapter(channel)
      const events = yield* Effect.try({
        try: () => createConnector(parseAdapter).webhooks.parse({ body: input.body, headers: input.headers }),
        catch: (cause) => new WhatsAppInvalidWebhookError({ reason: String(cause) }),
      })

      const allowedSessions = channel.sessionIds
      for (const event of events) {
        if (event.type !== "message.received") continue
        if (allowedSessions && event.instanceId && !allowedSessions.includes(event.instanceId)) continue
        if (event.message.fromMe) continue
        if (!isChatAllowed(channel, event.message.chatId)) continue

        // Deduplicação: se a mensagem já foi processada recentemente, ignora
        if (event.message.id) {
          if (processedMessageIds.has(event.message.id)) continue
          processedMessageIds.add(event.message.id)
          // Limita tamanho do cache de IDs
          if (processedMessageIds.size > 2000) {
            const first = processedMessageIds.values().next().value
            if (first) processedMessageIds.delete(first)
          }
        }

        const msgAdapter = buildAdapter(channel, event.instanceId)
        const attachment = yield* extractMediaAttachment(msgAdapter, event.message)
        const text = event.message.text?.trim()

        if (!text && !attachment) continue

        yield* enqueue({
          agentID: input.agentID,
          directory,
          channel,
          chatId: event.message.chatId,
          instanceId: event.instanceId,
          text: text || undefined,
          attachments: attachment ? [attachment] : undefined,
        })
      }
      return { ok: true as const }
    })

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
                  subject: group.subject,
                  sessionId: sid,
                  participantCount: group.participants.length,
                })
              }
            }),
            Effect.ignore,
          ),
        { concurrency: "unbounded" },
      )
      return Array.from(byID.values()).sort((a, b) => a.subject.localeCompare(b.subject))
    })

    return Service.of({ handleWebhook, listIzapiaSessions, listIzapiaGroups })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AgentUI.node],
})
