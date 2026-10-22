import type {
  CanonicalEvent,
  ConnectResult,
  InstanceState,
  InstanceStatus,
  MessageReceivedEvent,
  SentMessage,
  WaAdapter,
  WaMessage,
  WebhookInput,
} from "waconector"

type GroupInfo = NonNullable<Awaited<ReturnType<NonNullable<WaAdapter["groups"]["list"]>>>>[number]
type TypingState = "composing" | "recording" | "paused"

export const PAPI_BASE_URL = "https://api.papi.api.br"
export const PAPI_PANEL_URL = "https://papi.api.br"

export interface PapiOptions {
  token: string
  instanceId?: string
  apiKey?: string
  baseUrl?: string
  panelUrl?: string
}

const PAPI_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.delete",
  "presence.setTyping",
  "groups.list",
  "groups.getInfo",
  "webhooks.parse",
] as const

function normalizeJid(to: string): string {
  const trimmed = to.trim()
  if (trimmed.endsWith("@g.us")) return trimmed
  if (trimmed.includes("@")) return trimmed.split("@")[0].replace(/\D/g, "")
  return trimmed.replace(/\D/g, "")
}

export function papi(options: PapiOptions): WaAdapter {
  const baseUrl = (options.baseUrl || PAPI_BASE_URL).replace(/\/+$/, "")
  const instanceId = options.instanceId || ""
  const token = options.token.trim()
  const apiKey = options.apiKey?.trim() || token

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-panel-token": token,
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
  }

  const instance = {
    connect: async (): Promise<ConnectResult> => {
      if (!instanceId) return { raw: null }
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/qr`, { headers })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const qr = typeof data.qr === "string" ? data.qr : typeof data.base64 === "string" ? data.base64 : undefined
      const pairingCode = typeof data.pairingCode === "string" ? data.pairingCode : undefined
      return { qr, pairingCode, raw: data }
    },
    status: async (): Promise<InstanceStatus> => {
      if (!instanceId) return { state: "disconnected", raw: null }
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/status`, { headers })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const rawStatus = String(data.status || data.state || "").toLowerCase()
      let state: InstanceState = "unknown"
      if (rawStatus === "open" || rawStatus === "connected" || data.connected === true) {
        state = "connected"
      } else if (rawStatus === "connecting") {
        state = "connecting"
      } else if (rawStatus === "qrcode" || rawStatus === "qr") {
        state = "qr"
      } else if (rawStatus === "close" || rawStatus === "disconnected" || data.connected === false) {
        state = "disconnected"
      }
      return { state, raw: data }
    },
    logout: async (): Promise<void> => {
      if (!instanceId) return
      await fetch(`${baseUrl}/api/instances/${instanceId}/logout`, { method: "POST", headers })
    },
  }

  const messages = {
    sendText: async (input: { to: string; text: string }): Promise<SentMessage> => {
      const jid = normalizeJid(input.to)
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/send-text`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jid, text: input.text }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const id = String(data.messageId || data.id || (data.key as any)?.id || crypto.randomUUID())
      return { id, chatId: input.to, timestamp: Date.now(), raw: data }
    },
    sendMedia: async (input: {
      to: string
      media: { kind: string; url?: string; base64?: string; mimeType?: string; filename?: string }
      caption?: string
    }): Promise<SentMessage> => {
      const jid = normalizeJid(input.to)
      let endpoint = "send-image"
      const body: Record<string, unknown> = { jid }

      if (input.media.kind === "audio") {
        endpoint = "send-audio"
        if (input.media.url) body.url = input.media.url
        if (input.media.base64) body.base64 = input.media.base64
        body.ptt = true
      } else if (input.media.kind === "video") {
        endpoint = "send-video"
        if (input.media.url) body.url = input.media.url
        if (input.media.base64) body.base64 = input.media.base64
        if (input.caption) body.caption = input.caption
      } else if (input.media.kind === "document") {
        endpoint = "send-document"
        if (input.media.base64) body.base64 = input.media.base64
        if (input.media.url) body.url = input.media.url
        body.filename = input.media.filename || "document.pdf"
      } else if (input.media.kind === "sticker") {
        endpoint = "send-sticker"
        if (input.media.url) body.url = input.media.url
        if (input.media.base64) body.base64 = input.media.base64
      } else {
        endpoint = "send-image"
        if (input.media.url) body.url = input.media.url
        if (input.media.base64) body.base64 = input.media.base64
        if (input.caption) body.caption = input.caption
      }

      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const id = String(data.messageId || data.id || (data.key as any)?.id || crypto.randomUUID())
      return { id, chatId: input.to, timestamp: Date.now(), raw: data }
    },
    sendReaction: async (input: { to: string; messageId: string; emoji: string }): Promise<SentMessage> => {
      const jid = normalizeJid(input.to)
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/send-reaction`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jid, messageId: input.messageId, reaction: input.emoji }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { id: input.messageId, chatId: input.to, timestamp: Date.now(), raw: data }
    },
    delete: async (input: { to: string; messageId: string }): Promise<void> => {
      const jid = normalizeJid(input.to)
      await fetch(`${baseUrl}/api/instances/${instanceId}/delete-message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jid, messageId: input.messageId, forEveryone: true }),
      })
    },
  }

  const presence = {
    setTyping: async (input: { to: string; state: TypingState }): Promise<void> => {
      if (!instanceId) return
      const jid = normalizeJid(input.to)
      const papiPresence = input.state === "recording" ? "recording" : input.state === "composing" ? "composing" : "available"
      await fetch(`${baseUrl}/api/instances/${instanceId}/presence`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jid, presence: papiPresence }),
      }).catch(() => {})
    },
  }

  const groups = {
    list: async (): Promise<GroupInfo[]> => {
      if (!instanceId) return []
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/groups`, { headers })
      const data = (await res.json().catch(() => [])) as unknown
      const list = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : []
      return list.map((g: any) => ({
        id: String(g.id || g.jid || ""),
        subject: String(g.subject || g.name || "Grupo sem nome"),
        description: typeof g.description === "string" ? g.description : undefined,
        participants: Array.isArray(g.participants)
          ? g.participants.map((p: any) => ({
              id: String(p.id || p.jid || ""),
              isAdmin: Boolean(p.isAdmin || p.admin || p.is_admin),
              isSuperAdmin: Boolean(p.isSuperAdmin || p.is_super_admin),
            }))
          : [],
        raw: g,
      }))
    },
    getInfo: async (groupId: string): Promise<GroupInfo> => {
      const res = await fetch(`${baseUrl}/api/instances/${instanceId}/groups/${groupId}/metadata`, { headers })
      const data = (await res.json().catch(() => ({}))) as any
      const g = data?.data || data
      return {
        id: String(g.id || groupId),
        subject: String(g.subject || g.name || ""),
        description: typeof g.description === "string" ? g.description : undefined,
        participants: Array.isArray(g.participants)
          ? g.participants.map((p: any) => ({
              id: String(p.id || p.jid || ""),
              isAdmin: Boolean(p.isAdmin || p.admin || p.is_admin),
              isSuperAdmin: Boolean(p.isSuperAdmin || p.is_super_admin),
            }))
          : [],
        raw: data,
      }
    },
  }

  function parseWebhook(input: WebhookInput): CanonicalEvent[] {
    const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : undefined
    if (!body) return []

    const eventInstanceId = String(
      body.instance || body.instanceId || body.instance_id || (input.headers as any)?.["x-instance-id"] || instanceId,
    )

    // Coleta mensagens a partir do payload
    const rawItems: Record<string, unknown>[] = []
    if (Array.isArray(body.messages)) {
      for (const m of body.messages) if (m && typeof m === "object") rawItems.push(m as Record<string, unknown>)
    } else if (body.data && typeof body.data === "object") {
      const dataObj = body.data as Record<string, unknown>
      if (Array.isArray(dataObj.messages)) {
        for (const m of dataObj.messages) if (m && typeof m === "object") rawItems.push(m as Record<string, unknown>)
      } else if (dataObj.key || dataObj.jid || dataObj.message) {
        rawItems.push(dataObj)
      }
    } else if (body.key || body.jid || body.message || body.text) {
      rawItems.push(body)
    }

    const events: CanonicalEvent[] = []

    for (const rawMsg of rawItems) {
      const key = rawMsg.key && typeof rawMsg.key === "object" ? (rawMsg.key as Record<string, unknown>) : undefined
      const fromMe = Boolean(key?.fromMe ?? rawMsg.fromMe ?? false)
      const chatId = String(key?.remoteJid || rawMsg.jid || rawMsg.chatId || rawMsg.from || "")
      const from = typeof key?.participant === "string" ? key.participant : typeof rawMsg.from === "string" ? rawMsg.from : undefined
      const id = String(key?.id || rawMsg.id || rawMsg.messageId || Date.now())
      const timestamp = rawMsg.messageTimestamp ? Number(rawMsg.messageTimestamp) * 1000 : Date.now()

      // Extração de texto e mídia
      const msgContent =
        rawMsg.message && typeof rawMsg.message === "object" ? (rawMsg.message as Record<string, unknown>) : rawMsg
      const extText =
        msgContent.extendedTextMessage && typeof msgContent.extendedTextMessage === "object"
          ? (msgContent.extendedTextMessage as Record<string, unknown>)
          : undefined
      const imageMsg =
        msgContent.imageMessage && typeof msgContent.imageMessage === "object"
          ? (msgContent.imageMessage as Record<string, unknown>)
          : undefined
      const audioMsg =
        msgContent.audioMessage && typeof msgContent.audioMessage === "object"
          ? (msgContent.audioMessage as Record<string, unknown>)
          : undefined
      const videoMsg =
        msgContent.videoMessage && typeof msgContent.videoMessage === "object"
          ? (msgContent.videoMessage as Record<string, unknown>)
          : undefined
      const docMsg =
        msgContent.documentMessage && typeof msgContent.documentMessage === "object"
          ? (msgContent.documentMessage as Record<string, unknown>)
          : undefined

      let text: string | undefined =
        typeof msgContent.conversation === "string"
          ? msgContent.conversation
          : typeof extText?.text === "string"
            ? extText.text
            : typeof imageMsg?.caption === "string"
              ? imageMsg.caption
              : typeof videoMsg?.caption === "string"
                ? videoMsg.caption
                : typeof docMsg?.caption === "string"
                  ? docMsg.caption
                  : typeof rawMsg.text === "string"
                    ? rawMsg.text
                    : typeof rawMsg.body === "string"
                      ? rawMsg.body
                      : undefined

      let media: WaMessage["media"]
      let kind: WaMessage["kind"] = "text"

      if (imageMsg) {
        kind = "image"
        media = { kind: "image", mimeType: typeof imageMsg.mimetype === "string" ? imageMsg.mimetype : "image/jpeg" }
      } else if (audioMsg) {
        kind = "audio"
        media = { kind: "audio", mimeType: typeof audioMsg.mimetype === "string" ? audioMsg.mimetype : "audio/ogg" }
      } else if (videoMsg) {
        kind = "video"
        media = { kind: "video", mimeType: typeof videoMsg.mimetype === "string" ? videoMsg.mimetype : "video/mp4" }
      } else if (docMsg) {
        kind = "document"
        media = {
          kind: "document",
          mimeType: typeof docMsg.mimetype === "string" ? docMsg.mimetype : "application/pdf",
          filename: typeof docMsg.fileName === "string" ? docMsg.fileName : undefined,
        }
      }

      if (!text && !media) continue

      const message: WaMessage = {
        id,
        chatId,
        from,
        fromMe,
        timestamp,
        kind,
        text,
        media,
        raw: rawMsg,
      }

      const evt: MessageReceivedEvent = {
        type: "message.received",
        provider: "papi",
        instanceId: eventInstanceId || undefined,
        message,
        raw: body,
      }
      events.push(evt)
    }

    return events
  }

  return {
    provider: "papi",
    capabilities: PAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts: {},
    presence,
    parseWebhook,
  }
}
