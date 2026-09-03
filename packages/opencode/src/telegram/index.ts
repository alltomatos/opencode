export * as Telegram from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { Provider } from "../provider/provider"
import { Project } from "../project/project"
import { Auth } from "../auth"
import { TelegramChatSessions } from "./chat-sessions"
import type { ChatState } from "./chat-sessions"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID } from "../session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Permission } from "../permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"

const TELEGRAM_AUTH_KEY = "telegram"
const API_ROOT = "https://api.telegram.org"
const POLL_TIMEOUT_SECONDS = 25

export const BotInfo = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  firstName: Schema.String,
})
export type BotInfo = Schema.Schema.Type<typeof BotInfo>

export const Status = Schema.Struct({
  connected: Schema.Boolean,
  bot: Schema.optional(BotInfo),
})
export type Status = Schema.Schema.Type<typeof Status>

export class InvalidTokenError extends Schema.TaggedErrorClass<InvalidTokenError>()("TelegramInvalidTokenError", {
  message: Schema.String,
}) {}

// Telegram's own error payload shape for a failed Bot API call — see
// https://core.telegram.org/bots/api#making-requests.
type TelegramApiError = { ok: false; description?: string }
type TelegramGetMeResponse = { ok: true; result: { id: number; username?: string; first_name: string } }
type TelegramPhotoSize = { file_id: string; width: number; height: number }
type TelegramVoice = { file_id: string; mime_type?: string }
type TelegramAudio = { file_id: string; mime_type?: string }
type TelegramDocument = { file_id: string; mime_type?: string; file_name?: string }
type TelegramMessage = {
  chat: { id: number }
  text?: string
  caption?: string
  photo?: TelegramPhotoSize[]
  voice?: TelegramVoice
  audio?: TelegramAudio
  document?: TelegramDocument
}
type TelegramCallbackQuery = { id: string; data?: string; message?: { chat: { id: number } } }
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }
type TelegramGetUpdatesResponse = { ok: true; result: TelegramUpdate[] }
type TelegramGetFileResponse = { ok: true; result: { file_path?: string } }

async function fetchBotInfo(token: string): Promise<BotInfo> {
  const response = await fetch(`${API_ROOT}/bot${token}/getMe`)
  const body = (await response.json().catch(() => undefined)) as TelegramGetMeResponse | TelegramApiError | undefined
  if (!response.ok || !body?.ok) {
    const description = body && "description" in body ? body.description : undefined
    throw new Error(description ?? `Telegram API returned ${response.status}`)
  }
  if (!body.result.username) throw new Error("Bot has no username")
  return { id: body.result.id, username: body.result.username, firstName: body.result.first_name }
}

async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const url = `${API_ROOT}/bot${token}/getUpdates?offset=${offset}&timeout=${POLL_TIMEOUT_SECONDS}`
  // Bound the request well past Telegram's own server-side long-poll timeout
  // (the `timeout=` query param above) so a network hiccup can never hang
  // this fetch — and therefore this fiber's loop iteration — forever.
  const response = await fetch(url, { signal: AbortSignal.timeout((POLL_TIMEOUT_SECONDS + 10) * 1000) })
  const body = (await response.json().catch(() => undefined)) as TelegramGetUpdatesResponse | TelegramApiError | undefined
  if (!response.ok || !body?.ok) {
    const description = body && "description" in body ? body.description : undefined
    throw new Error(description ?? `Telegram API returned ${response.status}`)
  }
  return body.result
}

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024 // Telegram bot API's own download cap for regular bots.

// Fetches a photo/voice/audio/document attachment and returns it as a data
// URL — getFile resolves Telegram's file_id to a temporary file_path, which
// is then downloaded from Telegram's separate file-serving host.
async function downloadTelegramFile(token: string, fileId: string, fallbackMime: string): Promise<string> {
  const infoResponse = await fetch(`${API_ROOT}/bot${token}/getFile?file_id=${fileId}`)
  const infoBody = (await infoResponse.json().catch(() => undefined)) as
    | TelegramGetFileResponse
    | TelegramApiError
    | undefined
  if (!infoResponse.ok || !infoBody?.ok || !infoBody.result.file_path) {
    const description = infoBody && "description" in infoBody ? infoBody.description : undefined
    throw new Error(description ?? `Telegram getFile returned ${infoResponse.status}`)
  }
  const fileResponse = await fetch(`${API_ROOT}/file/bot${token}/${infoBody.result.file_path}`)
  if (!fileResponse.ok) throw new Error(`Telegram file download returned ${fileResponse.status}`)
  const buffer = await fileResponse.arrayBuffer()
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`Attachment too large (${buffer.byteLength} bytes)`)
  const mime = fileResponse.headers.get("content-type") ?? fallbackMime
  return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  })
}

async function sendTyping(token: string, chatId: number): Promise<void> {
  await fetch(`${API_ROOT}/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  })
}

// A tool asking for permission has no terminal to prompt on the other end —
// this is the Telegram equivalent of the desktop/TUI's approval dialog.
// callback_data is `perm:<requestID>:<reply>`; Telegram caps that at 64
// bytes, which permission IDs comfortably fit under.
async function sendApprovalRequest(
  token: string,
  chatId: number,
  request: { id: string; permission: string; patterns: readonly string[] },
): Promise<void> {
  const text = `🔐 Permissão solicitada: ${request.permission}\n${request.patterns.join(", ")}`
  await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Uma vez", callback_data: `perm:${request.id}:once` },
            { text: "✅ Sempre", callback_data: `perm:${request.id}:always` },
            { text: "❌ Negar", callback_data: `perm:${request.id}:reject` },
          ],
        ],
      },
    }),
  })
}

async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${API_ROOT}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  })
}

// Friendly one-line summary of what the session is doing right now, so a
// Telegram user gets the same "it's actually working" reassurance the
// desktop timeline gives for free — Telegram has no such view, and a long
// skill run with nothing but a typing dot reads as a dead chat.
function describeActivity(message: SessionV1.WithParts | undefined): string | undefined {
  if (!message) return undefined
  const parts = message.parts
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.type === "tool") {
      if (part.state.status === "completed") continue
      if (part.state.status === "error") return `⚠️ Erro em ${part.tool}, tentando continuar...`
      return `⚙️ Executando: ${part.tool}`
    }
    if (part.type === "reasoning") return "💭 Pensando..."
  }
  return undefined
}

export function extractText(result: SessionV1.WithParts): string {
  return result.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export interface Interface {
  readonly connect: (token: string, directory: string) => Effect.Effect<BotInfo, InvalidTokenError>
  readonly disconnect: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Telegram") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const instanceStore = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const provider = yield* Provider.Service
    const projects = yield* Project.Service
    const chatSessions = yield* TelegramChatSessions.Service
    const permission = yield* Permission.Service
    const events = yield* EventV2Bridge.Service

    // In-memory only (rebuilt as chats send their first message after a
    // restart) — enough to route a permission.asked event for a session
    // back to the Telegram chat that owns it.
    const sessionChats = new Map<string, number>()
    const rememberSession = (chatId: number, sessionID: string) => sessionChats.set(sessionID, chatId)

    const connect = Effect.fn("Telegram.connect")(function* (token: string, directory: string) {
      const bot = yield* Effect.tryPromise({
        try: () => fetchBotInfo(token),
        catch: (cause) => new InvalidTokenError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      yield* auth
        .set(TELEGRAM_AUTH_KEY, {
          type: "api",
          key: token,
          metadata: { botId: String(bot.id), username: bot.username, firstName: bot.firstName, directory },
        })
        .pipe(Effect.orDie)
      return bot
    })

    const disconnect = Effect.fn("Telegram.disconnect")(function* () {
      yield* auth.remove(TELEGRAM_AUTH_KEY).pipe(Effect.orDie)
    })

    const status = Effect.fn("Telegram.status")(function* () {
      const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
      if (!info || info.type !== "api" || !info.metadata?.username) return { connected: false }
      return {
        connected: true,
        bot: {
          id: Number(info.metadata.botId ?? 0),
          username: info.metadata.username,
          firstName: info.metadata.firstName ?? "",
        },
      }
    })

    const HELP_TEXT = [
      "Comandos disponíveis:",
      "/new — começa uma sessão nova nesta conversa",
      "/status — mostra repositório, modelo e sessão atual",
      "/repo — lista os projetos disponíveis",
      "/repo <número> — troca o repositório desta conversa",
      "/model — lista os modelos conectados",
      "/model <número> — troca o modelo desta conversa",
      "/skills — lista as skills disponíveis",
      "/help — mostra esta lista",
      "",
      "Também aceita foto e áudio/voz — envie junto com uma legenda ou mensagem.",
      "",
      "Qualquer outro /comando é encaminhado como comando do opencode (inclui skills customizadas).",
    ].join("\n")

    const WELCOME_TEXT = [
      "Bem vindo ao Opencode by alltomatos",
      "",
      "Esse bot te conecta a uma sessão do opencode direto pelo Telegram: escreva",
      "qualquer mensagem pra conversar com o agente, ou use os comandos abaixo",
      "pra controlar repositório, modelo e sessão.",
      "",
      HELP_TEXT,
    ].join("\n")

    const listRepos = Effect.fn("Telegram.listRepos")(function* () {
      const list = yield* projects.list()
      if (list.length === 0) return "Nenhum projeto encontrado."
      return (
        "Repositórios disponíveis:\n" +
        list.map((item, i) => `${i + 1}. ${item.name ?? item.worktree} (${item.worktree})`).join("\n") +
        "\n\nUse /repo <número> pra trocar."
      )
    })

    const listModels = Effect.fn("Telegram.listModels")(function* () {
      const list = yield* provider.list()
      const rows = Object.values(list).flatMap((p) =>
        Object.keys(p.models).map((modelID) => ({ providerID: p.id, modelID })),
      )
      if (rows.length === 0) return "Nenhum modelo conectado."
      return (
        "Modelos conectados:\n" +
        rows.map((row, i) => `${i + 1}. ${row.providerID}/${row.modelID}`).join("\n") +
        "\n\nUse /model <número> pra trocar."
      )
    })

    // Interprets a leading-slash message as a command instead of a prompt.
    // Known meta-commands manage the chat's own state (repo/model/session);
    // anything else forwards verbatim to promptSvc.command() — the exact
    // mechanism the CLI/TUI use for custom skill commands, so any skill
    // available in the connected repo works here for free.
    const runCommand = Effect.fn("Telegram.runCommand")(function* (
      chatId: number,
      state: ChatState,
      command: string,
      args: string,
    ) {
      if (command === "help") return HELP_TEXT

      if (command === "start") return WELCOME_TEXT

      if (command === "new") {
        yield* chatSessions.update(chatId, state.directory, (s) => ({ ...s, sessionID: undefined }))
        return "Sessão encerrada. A próxima mensagem começa uma conversa nova."
      }

      if (command === "status") {
        const model = state.model ? `${state.model.providerID}/${state.model.modelID}` : "(padrão do repositório)"
        return [
          `Repositório: ${state.directory}`,
          `Modelo: ${model}`,
          `Sessão: ${state.sessionID ?? "(nenhuma ainda — a próxima mensagem cria uma)"}`,
        ].join("\n")
      }

      if (command === "repo") {
        if (!args.trim()) return yield* listRepos()
        const list = yield* projects.list()
        const index = Number(args.trim()) - 1
        const picked = list[index]
        if (!picked) return `Repositório inválido. Use /repo pra ver a lista.`
        yield* chatSessions.set(chatId, { directory: picked.worktree, model: state.model, sessionID: undefined })
        return `Repositório trocado pra ${picked.name ?? picked.worktree}. A próxima mensagem começa uma sessão nova lá.`
      }

      if (command === "model") {
        if (!args.trim()) return yield* listModels()
        const rows = Object.values(yield* provider.list()).flatMap((p) =>
          Object.keys(p.models).map((modelID) => ({ providerID: p.id as string, modelID })),
        )
        const index = Number(args.trim()) - 1
        const picked = rows[index]
        if (!picked) return `Modelo inválido. Use /model pra ver a lista.`
        yield* chatSessions.update(chatId, state.directory, (s) => ({ ...s, model: picked }))
        return `Modelo trocado pra ${picked.providerID}/${picked.modelID}.`
      }

      if (command === "skills") {
        return "Digite qualquer comando de skill disponível no repositório (ex: /nome-da-skill) — ele é encaminhado direto pro opencode."
      }

      // Unknown command: forward to the real opencode command pipeline
      // (custom commands / skills), same as the CLI's "/name args" handling.
      const cached = yield* chatSessions.get(chatId)
      let sessionID = cached?.sessionID ? SessionID.make(cached.sessionID) : undefined
      if (!sessionID) {
        const session = yield* sessions.create({ title: `Telegram: ${chatId}`, directory: state.directory })
        sessionID = session.id
        yield* chatSessions.update(chatId, state.directory, (s) => ({ ...s, sessionID }))
      }
      rememberSession(chatId, sessionID)
      const result = yield* promptSvc.command({ sessionID, command, arguments: args })
      return extractText(result)
    })

    // One opencode session per Telegram chat: reuse the mapped session on
    // every message from a chat we've already seen, create one on the
    // first. A chat can switch repo/model via commands (see runCommand),
    // which resets the mapped session so the next message starts fresh in
    // the new context.
    const handleMessage = Effect.fn("Telegram.handleMessage")(function* (
      token: string,
      botDirectory: string,
      message: TelegramMessage,
    ) {
      const chatId = message.chat.id
      const text = message.text ?? message.caption ?? ""

      // Photos come as several resolutions of the same image — Telegram
      // orders `photo` smallest-first, so the last entry is the largest.
      // Voice notes are always OGG/Opus; audio/document attachments carry
      // their own mime type. Anything that isn't image/audio is skipped —
      // there's no use forwarding an arbitrary document as a "file" part
      // the model can't read.
      const attachments: { fileId: string; mime: string }[] = []
      const photo = message.photo?.at(-1)
      if (photo) attachments.push({ fileId: photo.file_id, mime: "image/jpeg" })
      if (message.voice) attachments.push({ fileId: message.voice.file_id, mime: message.voice.mime_type ?? "audio/ogg" })
      if (message.audio) attachments.push({ fileId: message.audio.file_id, mime: message.audio.mime_type ?? "audio/mpeg" })
      if (message.document?.mime_type?.match(/^(image|audio)\//))
        attachments.push({ fileId: message.document.file_id, mime: message.document.mime_type })

      if (!text && attachments.length === 0) return

      const state = (yield* chatSessions.get(chatId)) ?? { directory: botDirectory }
      const directory = state.directory
      const ctx = yield* instanceStore.load({ directory })

      // Telegram's "typing..." indicator auto-expires after ~5s, and a
      // skill/prompt run (orchestrator, etc.) can take minutes — without a
      // heartbeat the chat looks dead the whole time, unlike the desktop
      // timeline where the user can see each step happen. Resend "typing"
      // every 4s, and every 5th tick (~20s) also post a short status line
      // describing whatever tool/reasoning step the session is currently
      // on — a poor man's timeline for a text-only channel. Both stop the
      // moment the scope below closes.
      let lastActivity: string | undefined
      const reply = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              let tick = 0
              while (true) {
                yield* Effect.tryPromise(() => sendTyping(token, chatId)).pipe(Effect.ignore)
                tick++
                if (tick % 5 === 0) {
                  const activity = yield* Effect.gen(function* () {
                    const cached = yield* chatSessions.get(chatId)
                    if (!cached?.sessionID) return undefined
                    const [latest] = yield* sessions.messages({
                      sessionID: SessionID.make(cached.sessionID),
                      limit: 1,
                    })
                    return describeActivity(latest)
                  }).pipe(Effect.orElseSucceed(() => undefined))
                  const text = activity ?? (lastActivity ? undefined : "⏳ Ainda trabalhando nisso...")
                  if (text && text !== lastActivity) {
                    lastActivity = text
                    yield* Effect.tryPromise(() => sendMessage(token, chatId, text)).pipe(Effect.ignore)
                  }
                }
                yield* Effect.sleep("4 seconds")
              }
            }),
          )

          return yield* Effect.gen(function* () {
            if (text.startsWith("/")) {
              const [command, ...rest] = text.slice(1).split(/\s+/)
              return yield* runCommand(chatId, state, command.toLowerCase(), rest.join(" "))
            }

            const cached = yield* chatSessions.get(chatId)
            let sessionID = cached?.sessionID ? SessionID.make(cached.sessionID) : undefined
            if (!sessionID) {
              const session = yield* sessions.create({ title: `Telegram: ${chatId}`, directory })
              sessionID = session.id
              yield* chatSessions.update(chatId, directory, (s) => ({ ...s, sessionID }))
            }
            rememberSession(chatId, sessionID)
            const model = state.model
              ? { providerID: ProviderV2.ID.make(state.model.providerID), modelID: ModelV2.ID.make(state.model.modelID) }
              : undefined

            const fileParts = yield* Effect.forEach(attachments, (attachment) =>
              Effect.tryPromise(() => downloadTelegramFile(token, attachment.fileId, attachment.mime)).pipe(
                Effect.map((url) => ({ type: "file" as const, mime: attachment.mime, url })),
                Effect.tapError((cause) => Effect.logError("telegram attachment download failed", { chatId, cause })),
                Effect.option,
              ),
            ).pipe(Effect.map((results) => results.filter((r) => r._tag === "Some").map((r) => r.value)))

            const parts = [...fileParts, ...(text ? [{ type: "text" as const, text }] : [])]
            if (parts.length === 0) return "⚠️ Não consegui baixar o anexo enviado."
            const result = yield* promptSvc
              .prompt({ sessionID, model, parts })
              .pipe(Effect.map((withParts) => extractText(withParts)))
            return result
          }).pipe(
            Effect.provideService(InstanceRef, ctx),
            Effect.catch((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError("telegram prompt failed", { chatId, cause })
                return `⚠️ ${cause instanceof Error ? cause.message : String(cause)}`
              }),
            ),
          )
        }),
      )
      yield* Effect.tryPromise(() => sendMessage(token, chatId, reply || "(sem resposta)")).pipe(Effect.ignore)
    })

    // Approve/deny/always buttons on the message sendApprovalRequest posted.
    // Unroutable or already-resolved requests (e.g. the user tapped a stale
    // button after the tool timed out) just get a quiet acknowledgement —
    // Permission.reply on an unknown requestID is a NotFoundError, not
    // something worth surfacing back to the chat.
    const handleCallbackQuery = Effect.fn("Telegram.handleCallbackQuery")(function* (
      token: string,
      cb: TelegramCallbackQuery,
    ) {
      const [, requestID, action] = (cb.data ?? "").split(":")
      if (!requestID || !action) {
        yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id)).pipe(Effect.ignore)
        return
      }
      const reply = action === "always" || action === "reject" ? action : "once"
      yield* permission.reply({ requestID: PermissionV1.ID.make(requestID), reply }).pipe(Effect.ignore)
      const label = action === "always" ? "✅ Permitido sempre" : action === "reject" ? "❌ Negado" : "✅ Permitido"
      yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id, label)).pipe(Effect.ignore)
      if (cb.message?.chat.id)
        yield* Effect.tryPromise(() => sendMessage(token, cb.message!.chat.id, label)).pipe(Effect.ignore)
    })

    // No terminal exists on the other end of a Telegram chat to show the
    // usual approval dialog, so mirror every permission.asked for a
    // Telegram-owned session as a message with approve/deny buttons.
    yield* Effect.forkScoped(
      events.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== "permission.asked") return
          const request = event.data as PermissionV1.Request
          const chatId = sessionChats.get(request.sessionID)
          if (!chatId) return
          const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
          if (!info || info.type !== "api") return
          yield* Effect.tryPromise(() =>
            sendApprovalRequest(info.key, chatId, {
              id: request.id,
              permission: request.permission,
              patterns: request.patterns,
            }),
          ).pipe(Effect.ignore)
        }),
      ),
    )

    // Long-poll for the whole server's lifetime, only doing real work while
    // a bot is connected. Sleeps briefly instead of hammering the API when
    // disconnected or between transient errors.
    const pollLoop = Effect.gen(function* () {
      let offset = 0
      while (true) {
        yield* Effect.logInfo("telegram poll tick", { offset })
        const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
        if (!info || info.type !== "api" || !info.metadata?.directory) {
          yield* Effect.logInfo("telegram poll: no bot connected")
          yield* Effect.sleep("2 seconds")
          continue
        }
        const token = info.key
        const directory = info.metadata.directory
        const updates = yield* Effect.tryPromise(() => getUpdates(token, offset)).pipe(
          Effect.tapError((cause) => Effect.logError("telegram getUpdates failed", { cause })),
          Effect.catch(() => Effect.sleep("3 seconds").pipe(Effect.as<TelegramUpdate[]>([]))),
        )
        yield* Effect.logInfo("telegram poll: got updates", { count: updates.length })
        // Telegram never returns instantly with an empty array on a
        // successful poll — an empty result only comes back after the full
        // `timeout=` server-side wait — but this floor guards against ever
        // spinning the loop as fast as the event loop allows if that
        // assumption turns out wrong for some edge case (e.g. a proxy
        // stripping the timeout param).
        if (updates.length === 0) yield* Effect.sleep("1 second")
        for (const update of updates) {
          offset = update.update_id + 1
          if (update.callback_query)
            yield* handleCallbackQuery(token, update.callback_query).pipe(
              Effect.tapError((cause) => Effect.logError("telegram handleCallbackQuery failed", { cause })),
              Effect.ignore,
            )
          if (update.message)
            yield* handleMessage(token, directory, update.message).pipe(
              Effect.tapError((cause) => Effect.logError("telegram handleMessage failed", { cause })),
              Effect.ignore,
            )
        }
      }
    })
    yield* Effect.forkScoped(pollLoop)

    return Service.of({ connect, disconnect, status })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Auth.node,
    InstanceStore.node,
    Session.node,
    SessionPrompt.node,
    Provider.node,
    Project.node,
    TelegramChatSessions.node,
    Permission.node,
    EventV2Bridge.node,
  ],
})
