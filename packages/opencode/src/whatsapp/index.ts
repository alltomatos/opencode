export * as WhatsApp from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { AgentUI } from "@/agentui"
import { Context, Duration, Effect, Fiber, Layer, Schedule, Schema, Scope } from "effect"
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { createConnector, type WaAdapter, type WaMessage } from "waconector"
import { izapia } from "waconector/izapia"
import { buildAdapter, IZAPIA_BASE_URL } from "./adapter"
import { papi, PAPI_BASE_URL, PAPI_PANEL_URL } from "./papi"

export { buildAdapter }

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

export const IzapiaGroupParticipant = Schema.Struct({
  jid: Schema.String,
  name: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  isAdmin: Schema.Boolean,
  isSuperAdmin: Schema.Boolean,
})
export type IzapiaGroupParticipant = Schema.Schema.Type<typeof IzapiaGroupParticipant>

export const PapiInstance = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.String,
  jid: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
})
export type PapiInstance = Schema.Schema.Type<typeof PapiInstance>

export const PapiGroup = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  sessionId: Schema.String,
  participantCount: Schema.Number,
})
export type PapiGroup = Schema.Schema.Type<typeof PapiGroup>

// izapia is multi-tenant / multi-session: its API base is fixed across all
// accounts (unlike self-hosted WAHA/Evolution which need a user-provided
// baseUrl).

function findChannel(agent: ConfigAgentUIV1.Agent): ConfigAgentUIV1.WhatsAppChannelBinding | undefined {
  const found = agent.channels.find((c) => c.type === "whatsapp")
  return found && found.type === "whatsapp" ? found : undefined
}

function isChatAllowed(channel: ConfigAgentUIV1.WhatsAppChannelBinding, chatId: string): boolean {
  if (!chatId.endsWith("@g.us")) return true
  const allowed = channel.allowedGroups
  return Array.isArray(allowed) && allowed.includes(chatId)
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D+/g, "")
}

function isSenderAllowed(channel: ConfigAgentUIV1.WhatsAppChannelBinding, message: WaMessage): boolean {
  const globalAllowed = channel.allowedSenders
  const isGroup = message.chatId.endsWith("@g.us")
  const groupRules = (channel as any).groupAllowedSenders as Record<string, string[]> | undefined
  const groupSpecificAllowed = isGroup && groupRules ? groupRules[message.chatId] : undefined

  // Se for um grupo e o grupo tiver uma lista explícita de participantes permitidos:
  // Só quem estiver nessa lista de grupo (ou na lista global se definida) pode falar.
  // Se nem a lista de grupo nem a global estiverem configuradas, qualquer um pode falar.
  const hasGroupRule = Array.isArray(groupSpecificAllowed) && groupSpecificAllowed.length > 0
  const hasGlobalRule = Array.isArray(globalAllowed) && globalAllowed.length > 0

  if (!hasGroupRule && !hasGlobalRule) return true

  // Coleta possíveis identificadores do remetente
  const candidates: string[] = []
  if (message.from) candidates.push(message.from)
  if (!isGroup && message.chatId) candidates.push(message.chatId)

  // Extrai de campos brutos se existirem no payload de diferentes provedores
  const raw = message.raw && typeof message.raw === "object" ? (message.raw as Record<string, unknown>) : undefined
  if (raw) {
    if (typeof raw.participant === "string") candidates.push(raw.participant)
    if (typeof raw.author === "string") candidates.push(raw.author)
    if (typeof raw.sender === "string") candidates.push(raw.sender)
  }

  // Lista de regras efetivas para esta mensagem
  const allowedList: string[] = []
  if (hasGroupRule) {
    allowedList.push(...groupSpecificAllowed!)
  }
  // Se tiver regra global, os remetentes globais também são permitidos
  if (hasGlobalRule) {
    allowedList.push(...globalAllowed!)
  }

  const normalizedAllowed = allowedList.map((item) => {
    const digits = normalizePhoneNumber(item)
    return { raw: item.trim(), digits }
  })

  for (const candidate of candidates) {
    const candidateDigits = normalizePhoneNumber(candidate)
    for (const rule of normalizedAllowed) {
      if (rule.raw && candidate === rule.raw) return true
      if (rule.digits && candidateDigits.includes(rule.digits)) return true
    }
  }

  return false
}

function isMentioned(message: WaMessage, botJids: string[], botNumbers: string[]): boolean {
  // Se veio em grupo, verifica se foi mencionado
  const text = (message.text || "").toLowerCase()

  // 1. Verifica no raw da mensagem se tem mentionedJid ou contextInfo.mentionedJid
  const raw = message.raw && typeof message.raw === "object" ? (message.raw as Record<string, unknown>) : undefined
  const data = raw && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : undefined
  const contextInfo =
    (raw?.contextInfo && typeof raw.contextInfo === "object" ? (raw.contextInfo as Record<string, unknown>) : undefined) ||
    (data?.contextInfo && typeof data.contextInfo === "object" ? (data.contextInfo as Record<string, unknown>) : undefined)

  const mentionedJids: string[] = []
  if (Array.isArray(raw?.mentionedJid)) {
    for (const jid of raw.mentionedJid) if (typeof jid === "string") mentionedJids.push(jid)
  }
  if (Array.isArray(data?.mentionedJid)) {
    for (const jid of data.mentionedJid) if (typeof jid === "string") mentionedJids.push(jid)
  }
  if (Array.isArray(contextInfo?.mentionedJid)) {
    for (const jid of contextInfo.mentionedJid) if (typeof jid === "string") mentionedJids.push(jid)
  }

  for (const botJid of botJids) {
    if (mentionedJids.includes(botJid)) return true
    const botUser = botJid.split("@")[0].split(":")[0]
    if (botUser && mentionedJids.some((j) => j.startsWith(botUser))) return true
  }

  // 2. Verifica se foi citado (quoted message do bot)
  const participantQuoted = typeof contextInfo?.participant === "string" ? contextInfo.participant : undefined
  if (participantQuoted) {
    for (const botJid of botJids) {
      if (participantQuoted === botJid) return true
      const botUser = botJid.split("@")[0].split(":")[0]
      if (botUser && participantQuoted.startsWith(botUser)) return true
    }
  }

  // 3. Fallback de texto: checa se contém @<numero_do_bot>
  for (const num of botNumbers) {
    if (num && text.includes(`@${num}`)) return true
  }

  return false
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
  readonly listIzapiaGroupParticipants: (input: {
    apiKey: string
    sid: string
    groupId: string
  }) => Effect.Effect<IzapiaGroupParticipant[], WhatsAppProviderApiError>
  readonly listPapiInstances: (input: {
    token: string
  }) => Effect.Effect<PapiInstance[], WhatsAppProviderApiError>
  readonly createPapiInstance: (input: {
    token: string
    instanceName: string
  }) => Effect.Effect<PapiInstance, WhatsAppProviderApiError>
  readonly setupPapiWebhook: (input: {
    token: string
    instanceId: string
    webhookUrl: string
  }) => Effect.Effect<{ ok: true; url: string }, WhatsAppProviderApiError>
  readonly listPapiGroups: (input: {
    token: string
    instanceIds: readonly string[]
  }) => Effect.Effect<PapiGroup[], never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WhatsApp") {}

// 7 segundos de janela de debounce para acumular mensagens sequenciais curtas
// enviadas por pessoas antes do agente formular a resposta única.
const DEBOUNCE = Duration.seconds(7)

interface WhatsAppAttachment {
  filename?: string
  mime: string
  url: string
  localPath?: string
}

function sanitizeDirName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function getSubfolderForMime(mime: string): string {
  if (mime.startsWith("audio/")) return "audios"
  if (mime.startsWith("image/")) return "images"
  if (mime.startsWith("video/")) return "videos"
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("document") || mime.includes("sheet"))
    return "docs"
  return "files"
}

function getExtensionForMime(mime: string): string {
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg"
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3"
  if (mime.includes("wav")) return ".wav"
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg"
  if (mime.includes("png")) return ".png"
  if (mime.includes("webp")) return ".webp"
  if (mime.includes("pdf")) return ".pdf"
  if (mime.includes("presentation") || mime.includes("powerpoint")) return ".pptx"
  if (mime.includes("spreadsheet") || mime.includes("excel")) return ".xlsx"
  if (mime.includes("wordprocessingml") || mime.includes("msword")) return ".docx"
  return ""
}

const saveMediaToDisk = (
  baseDirectory: string,
  chatId: string,
  filename: string,
  mime: string,
  base64Data: string,
): Effect.Effect<string | undefined> =>
  Effect.tryPromise(async () => {
    try {
      const cleanChatId = sanitizeDirName(chatId)
      const subfolder = getSubfolderForMime(mime)
      const targetDir = path.join(os.tmpdir(), "opencode", "media", "whatsapp", cleanChatId, subfolder)
      await fs.mkdir(targetDir, { recursive: true })

      let finalFilename = filename
      if (!path.extname(finalFilename)) {
        finalFilename += getExtensionForMime(mime)
      }
      // Adiciona timestamp no nome se for anexo genérico
      if (finalFilename.startsWith("anexo_")) {
        const d = new Date()
        const datePrefix = d.toISOString().replace(/[:.]/g, "-").slice(0, 19)
        finalFilename = `${datePrefix}_${finalFilename}`
      }

      const filePath = path.join(targetDir, finalFilename)
      const buffer = Buffer.from(base64Data, "base64")
      await fs.writeFile(filePath, buffer)
      return filePath
    } catch {
      return undefined
    }
  }).pipe(Effect.option, Effect.map((opt) => (opt._tag === "Some" ? opt.value : undefined)))

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
      directory: string,
    ): Effect.Effect<WhatsAppAttachment | undefined> =>
      Effect.gen(function* () {
        if (msg.media) {
          const media = msg.media
          if (media.base64) {
            const mime = media.mimeType || "application/octet-stream"
            const filename = media.filename || `anexo_${Date.now()}`
            const localPath = yield* saveMediaToDisk(directory, msg.chatId, filename, mime, media.base64)
            return {
              filename,
              mime,
              url: `data:${mime};base64,${media.base64}`,
              localPath,
            }
          }
          if (media.url && media.url.startsWith("http")) {
            // Tenta baixar a URL caso o provedor exponha link público ou temporário
            const res = yield* Effect.tryPromise(() => fetch(media.url!)).pipe(Effect.option)
            if (res._tag === "Some" && res.value.ok) {
              const buf = yield* Effect.promise(() => res.value.arrayBuffer())
              const base64 = Buffer.from(buf).toString("base64")
              const mime = media.mimeType || res.value.headers.get("content-type") || "application/octet-stream"
              const filename = media.filename || `anexo_${Date.now()}`
              const localPath = yield* saveMediaToDisk(directory, msg.chatId, filename, mime, base64)
              return {
                filename,
                mime,
                url: `data:${mime};base64,${base64}`,
                localPath,
              }
            }
          }
        }

        // Tenta baixar via connector.messages.download caso o provedor suporte (ex.: izapia, waha, evolution)
        const connector = createConnector(adapter)
        const downloaded = yield* Effect.tryPromise(() =>
          connector.messages.download({ messageId: msg.id, raw: msg.raw }),
        ).pipe(Effect.option)

        if (downloaded._tag === "Some" && downloaded.value.base64) {
          const mime = downloaded.value.mimeType || msg.media?.mimeType || "application/octet-stream"
          const filename = downloaded.value.filename || msg.media?.filename || `anexo_${Date.now()}`
          const localPath = yield* saveMediaToDisk(directory, msg.chatId, filename, mime, downloaded.value.base64)
          return {
            filename,
            mime,
            url: `data:${mime};base64,${downloaded.value.base64}`,
            localPath,
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
      const directory = channel.directory || (yield* agentUI.getProjectDirectory())

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
        if (!isSenderAllowed(channel, event.message)) continue

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
        const attachment = yield* extractMediaAttachment(msgAdapter, event.message, directory)
        const raw = event.message.raw && typeof event.message.raw === "object" ? (event.message.raw as Record<string, unknown>) : undefined
        const rawData = raw && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : undefined
        const caption = typeof raw?.caption === "string" ? raw.caption : typeof rawData?.caption === "string" ? rawData.caption : undefined
        const text = (event.message.text || caption || "").trim()

        if (!text && !attachment) continue

        // Se mentionOnly estiver ativo no canal e a mensagem for de um grupo,
        // só responde se o bot for explicitamente mencionado (@) ou citado
        if (channel.mentionOnly && event.message.chatId.endsWith("@g.us")) {
          // Descobre JIDs e números dos bots da sessão
          const botJids: string[] = []
          const botNumbers: string[] = []
          const rawSessionJid = typeof (rawData as any)?.instance_jid === "string" ? (rawData as any).instance_jid : undefined
          if (rawSessionJid) {
            botJids.push(rawSessionJid)
            botNumbers.push(normalizePhoneNumber(rawSessionJid))
          }
          if (event.instanceId) {
            // Tenta pegar da lista de sessões ou JID conhecido
            const sidDigits = normalizePhoneNumber(event.instanceId)
            if (sidDigits.length >= 10) botNumbers.push(sidDigits)
          }
          // Extrai menções conhecidas
          const mentioned = isMentioned(event.message, botJids, botNumbers)
          if (!mentioned) {
            // Se não foi mencionado no grupo, ignora
            continue
          }
        }

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

    const listIzapiaGroupParticipants = Effect.fn("WhatsApp.listIzapiaGroupParticipants")(function* (input: {
      apiKey: string
      sid: string
      groupId: string
    }) {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${IZAPIA_BASE_URL}/api/v1/sessions/${input.sid}/groups/${input.groupId}`, {
            headers: { authorization: `Bearer ${input.apiKey}` },
          }),
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      if (!response.ok) {
        return yield* new WhatsAppProviderApiError({ reason: `izapia respondeu ${response.status} ao consultar grupo` })
      }
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
      const data = record?.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record
      const rawParticipants = Array.isArray(data?.participants) ? (data.participants as Record<string, unknown>[]) : []

      // Opcional: tenta resolver nomes dos contatos
      const participants: IzapiaGroupParticipant[] = rawParticipants.map((p) => {
        const jid = String(p.jid ?? "")
        const digits = normalizePhoneNumber(jid)
        return {
          jid,
          name: typeof p.push_name === "string" ? p.push_name : undefined,
          phone: digits.length >= 8 ? digits : undefined,
          isAdmin: Boolean(p.is_admin),
          isSuperAdmin: Boolean(p.is_super_admin),
        }
      })

      // Enriquece participantes com os contatos da sessão se possível
      const contactsRes = yield* Effect.tryPromise(() =>
        fetch(`${IZAPIA_BASE_URL}/api/v1/sessions/${input.sid}/contacts`, {
          headers: { authorization: `Bearer ${input.apiKey}` },
        }).then((res) => (res.ok ? res.json() : null)),
      ).pipe(Effect.option)

      if (contactsRes._tag === "Some" && contactsRes.value) {
        const cBody = contactsRes.value as Record<string, unknown>
        const cList = Array.isArray(cBody) ? cBody : Array.isArray(cBody?.data) ? (cBody.data as Record<string, unknown>[]) : []
        const contactMap = new Map<string, { name?: string; phone?: string }>()
        for (const c of cList) {
          const cJid = String(c.jid ?? "")
          const cName = String(c.full_name || c.push_name || c.first_name || c.business_name || "").trim()
          const cPhone = normalizePhoneNumber(cJid)
          if (cJid) {
            contactMap.set(cJid, { name: cName || undefined, phone: cPhone.length >= 8 ? cPhone : undefined })
          }
          // Adiciona também mapeamento por dispositivo ou número se aplicável
          if (Array.isArray(c.devices)) {
            for (const d of c.devices) {
              if (typeof d === "string") {
                contactMap.set(d, { name: cName || undefined, phone: cPhone.length >= 8 ? cPhone : undefined })
                const baseD = d.split(":")[0]
                if (baseD) contactMap.set(baseD, { name: cName || undefined, phone: cPhone.length >= 8 ? cPhone : undefined })
              }
            }
          }
        }

        return participants.map((part) => {
          const found = contactMap.get(part.jid) || contactMap.get(part.jid.split(":")[0])
          if (!found) return part
          return {
            ...part,
            name: part.name || found.name,
            phone: part.phone || found.phone,
          }
        })
      }

      return participants
    })

    const listPapiInstances = Effect.fn("WhatsApp.listPapiInstances")(function* (input: { token: string }) {
      const cleanToken = input.token.trim()
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${PAPI_PANEL_URL}/api/v1/instances`, {
            headers: { "x-panel-token": cleanToken },
          }),
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      if (!response.ok) {
        return yield* new WhatsAppProviderApiError({ reason: `Papi respondeu ${response.status} ao listar instâncias` })
      }
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
      const list = Array.isArray(body)
        ? body
        : Array.isArray(record?.instances)
          ? (record.instances as unknown[])
          : Array.isArray(record?.data)
            ? (record.data as unknown[])
            : undefined
      if (!list) return yield* new WhatsAppProviderApiError({ reason: "resposta inesperada da API da Papi Cloud" })
      return list
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: String(item.id || item.instanceId || item.uuid || item.name || ""),
          name: typeof item.instanceName === "string" ? item.instanceName : typeof item.name === "string" ? item.name : undefined,
          status: String(item.status || item.connectionStatus || item.state || "unknown"),
          jid: typeof item.jid === "string" ? item.jid : typeof item.ownerJid === "string" ? item.ownerJid : undefined,
          apiKey: typeof item.apiKey === "string" ? item.apiKey : typeof item.apikey === "string" ? item.apikey : undefined,
        }))
        .filter((session) => session.id)
    })

    const createPapiInstance = Effect.fn("WhatsApp.createPapiInstance")(function* (input: {
      token: string
      instanceName: string
    }) {
      const cleanToken = input.token.trim()
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${PAPI_PANEL_URL}/api/v1/instances`, {
            method: "POST",
            headers: {
              "x-panel-token": cleanToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ instanceName: input.instanceName }),
          }),
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      if (!response.ok) {
        return yield* new WhatsAppProviderApiError({ reason: `Papi respondeu ${response.status} ao criar instância` })
      }
      const body = (yield* Effect.tryPromise({
        try: () => response.json() as Promise<any>,
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })) as any
      const item = body?.instance || body?.data || body
      return {
        id: String(item.id || item.instanceId || item.uuid || input.instanceName),
        name: typeof item.instanceName === "string" ? item.instanceName : input.instanceName,
        status: String(item.status || "created"),
        jid: typeof item.jid === "string" ? item.jid : undefined,
        apiKey: typeof item.apiKey === "string" ? item.apiKey : typeof item.apikey === "string" ? item.apikey : undefined,
      }
    })

    const setupPapiWebhook = Effect.fn("WhatsApp.setupPapiWebhook")(function* (input: {
      token: string
      instanceId: string
      webhookUrl: string
    }) {
      const cleanToken = input.token.trim()
      const headers: Record<string, string> = {
        "x-panel-token": cleanToken,
        apikey: cleanToken,
        authorization: `Bearer ${cleanToken}`,
        "Content-Type": "application/json",
      }
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${PAPI_BASE_URL}/api/instances/${input.instanceId}/webhook`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              url: input.webhookUrl,
              enabled: true,
              events: ["messages", "status"],
            }),
          }),
        catch: (cause) => new WhatsAppProviderApiError({ reason: String(cause) }),
      })
      if (!response.ok) {
        return yield* new WhatsAppProviderApiError({ reason: `Papi respondeu ${response.status} ao configurar webhook` })
      }
      return { ok: true as const, url: input.webhookUrl }
    })

    const listPapiGroups = Effect.fn("WhatsApp.listPapiGroups")(function* (input: {
      token: string
      instanceIds: readonly string[]
    }) {
      const byID = new Map<string, PapiGroup>()
      yield* Effect.forEach(
        input.instanceIds,
        (instanceId) =>
          Effect.tryPromise(() =>
            createConnector(papi({ token: input.token, instanceId })).groups.list(),
          ).pipe(
            Effect.map((groups) => {
              for (const group of groups) {
                if (byID.has(group.id)) continue
                byID.set(group.id, {
                  id: group.id,
                  subject: group.subject,
                  sessionId: instanceId,
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

    return Service.of({
      handleWebhook,
      listIzapiaSessions,
      listIzapiaGroups,
      listIzapiaGroupParticipants,
      listPapiInstances,
      createPapiInstance,
      setupPapiWebhook,
      listPapiGroups,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AgentUI.node],
})
