export * as Telegram from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import type { InstanceContext } from "@/project/instance-context"
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
import { Question } from "../question"
import { QuestionV1 } from "@opencode-ai/schema/question-v1"
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

// Multi-select is not offered over Telegram buttons — one tap picks one
// option, same as answering a single-choice poll. `custom` still works via
// a plain text reply, handled separately in handleMessage.
async function sendQuestion(
  token: string,
  chatId: number,
  requestID: string,
  info: { question: string; options: readonly { label: string }[]; custom?: boolean },
): Promise<void> {
  const note = info.custom === false ? "" : "\n\n(ou digite sua própria resposta)"
  await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `❓ ${info.question}${note}`,
      reply_markup: {
        inline_keyboard: info.options.map((option, i) => [
          { text: option.label.slice(0, 60), callback_data: `ques:${requestID}:${i}` },
        ]),
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
    const question = yield* Question.Service
    const events = yield* EventV2Bridge.Service

    // In-memory only (rebuilt as chats send their first message after a
    // restart) — enough to route a permission.asked/question.asked event
    // for a session back to the Telegram chat that owns it.
    const sessionChats = new Map<string, number>()
    const rememberSession = (chatId: number, sessionID: string) => sessionChats.set(sessionID, chatId)

    // A multi-question request (e.g. from /grill-me) is answered one
    // question at a time — each button tap or free-text reply advances
    // `index` until every question has an answer, then question.reply()
    // fires with the full array.
    interface PendingQuestion {
      chatId: number
      questions: readonly Question.Info[]
      index: number
      answers: string[][]
    }
    const pendingQuestions = new Map<string, PendingQuestion>()

    // Consumes the message as this chat's answer to its current pending
    // question, if any — returns false (message untouched) otherwise, so
    // the caller falls through to normal command/prompt handling.
    const tryAnswerPendingQuestion = Effect.fn("Telegram.tryAnswerPendingQuestion")(function* (
      token: string,
      chatId: number,
      text: string,
    ) {
      if (!text || text.startsWith("/")) return false
      const entry = Array.from(pendingQuestions.entries()).find(([, v]) => v.chatId === chatId)
      if (!entry) return false
      const [requestID, state] = entry
      if (state.questions[state.index]?.custom === false) return false
      yield* advanceQuestion(token, requestID, state, [text])
      return true
    })

    const advanceQuestion = Effect.fn("Telegram.advanceQuestion")(function* (
      token: string,
      requestID: string,
      state: PendingQuestion,
      answer: string[],
    ) {
      state.answers.push(answer)
      state.index++
      if (state.index < state.questions.length) {
        yield* Effect.tryPromise(() =>
          sendQuestion(token, state.chatId, requestID, state.questions[state.index]!),
        ).pipe(Effect.ignore)
        return
      }
      pendingQuestions.delete(requestID)
      yield* question
        .reply({ requestID: QuestionV1.ID.make(requestID), answers: state.answers })
        .pipe(Effect.ignore)
      yield* Effect.tryPromise(() => sendMessage(token, state.chatId, "✅ Respostas enviadas.")).pipe(Effect.ignore)
    })

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
      "/model-subagent — lista modelos pro subagent (tarefas em segundo plano)",
      "/model-subagent <número> — troca o modelo do subagent",
      "/skills — lista as skills disponíveis",
      "/help — mostra esta lista",
      "",
      "Também aceita foto e áudio/voz — envie junto com uma legenda ou mensagem.",
      "",
      "Qualquer outro /comando é encaminhado como comando do opencode (inclui skills customizadas).",
      "",
      "Todo pedido que aciona o modelo roda em segundo plano — se chegar outro",
      "pedido enquanto um ainda está rodando, eu pergunto se é pra rodar em",
      "paralelo ou esperar na fila.",
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

    const listModels = Effect.fn("Telegram.listModels")(function* (command: string = "model") {
      const list = yield* provider.list()
      const rows = Object.values(list).flatMap((p) =>
        Object.keys(p.models).map((modelID) => ({ providerID: p.id, modelID })),
      )
      if (rows.length === 0) return "Nenhum modelo conectado."
      return (
        "Modelos conectados:\n" +
        rows.map((row, i) => `${i + 1}. ${row.providerID}/${row.modelID}`).join("\n") +
        `\n\nUse /${command} <número> pra trocar.`
      )
    })

    // Any request that actually calls the model (a plain message, or a
    // forwarded skill command) runs in a background subagent session
    // rather than blocking this chat's own fast commands — a stuck or
    // slow-running skill (like /orchestrator taking many minutes) used to
    // wedge the whole poll loop, since it awaited the prompt inline before
    // moving to the next Telegram update. Tracking active/queued tasks per
    // chat also lets us ask the user how to handle a second request that
    // comes in while one is still running, instead of silently choosing.
    interface RunningTask {
      sessionID: string
    }
    interface QueuedRequest {
      text: string
      attachments: { fileId: string; mime: string }[]
    }
    interface PendingRunChoice extends QueuedRequest {
      chatId: number
    }
    const activeTasksByChat = new Map<number, RunningTask[]>()
    const queuedTasksByChat = new Map<number, QueuedRequest[]>()
    const pendingRunChoices = new Map<string, PendingRunChoice>()
    let runChoiceSeq = 0

    async function sendRunChoice(token: string, chatId: number, id: string): Promise<void> {
      await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Como prefere?",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "▶️ Rodar em paralelo", callback_data: `run:${id}:parallel` },
                { text: "⏳ Rodar depois (fila)", callback_data: `run:${id}:queue` },
              ],
            ],
          },
        }),
      })
    }

    // Creates a fresh child session (subagent) for one request and runs it
    // fully detached from the caller — forked onto the service's own
    // long-lived scope, not the caller's, so it keeps running (with its own
    // typing/progress heartbeat) even after the handler that started it has
    // already returned. When it finishes, pulls the next queued request (if
    // any) for the same chat.
    const resolveTaskSessionID = Effect.fn("Telegram.resolveTaskSessionID")(function* (
      chatId: number,
      directory: string,
      ctx: InstanceContext,
      sessionOverride?: SessionID,
    ) {
      if (sessionOverride) return sessionOverride
      const state = (yield* chatSessions.get(chatId)) ?? { directory }
      if (state.sessionID) return SessionID.make(state.sessionID)
      const session = yield* sessions
        .create({ title: `Telegram: ${chatId}`, directory })
        .pipe(Effect.provideService(InstanceRef, ctx))
      yield* chatSessions.update(chatId, directory, (s) => ({ ...s, sessionID: session.id }))
      return session.id
    })

    const runOneTask = Effect.fn("Telegram.runOneTask")(function* (
      token: string,
      chatId: number,
      directory: string,
      sessionID: SessionID,
      text: string,
      attachments: { fileId: string; mime: string }[],
      ctx: InstanceContext,
    ) {
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
                  const activity = yield* sessions
                    .messages({ sessionID, limit: 1 })
                    .pipe(
                      Effect.map(([latest]) => describeActivity(latest)),
                      Effect.orElseSucceed(() => undefined),
                    )
                  const line = activity ?? (lastActivity ? undefined : "⏳ Ainda trabalhando nisso...")
                  if (line && line !== lastActivity) {
                    lastActivity = line
                    yield* Effect.tryPromise(() => sendMessage(token, chatId, line)).pipe(Effect.ignore)
                  }
                }
                yield* Effect.sleep("4 seconds")
              }
            }),
          )

          return yield* Effect.gen(function* () {
            if (text.startsWith("/")) {
              const [command, ...rest] = text.slice(1).split(/\s+/)
              const result = yield* promptSvc.command({ sessionID, command, arguments: rest.join(" ") })
              return extractText(result)
            }

            const fileParts = yield* Effect.forEach(attachments, (attachment) =>
              Effect.tryPromise(() => downloadTelegramFile(token, attachment.fileId, attachment.mime)).pipe(
                Effect.map((url) => ({ type: "file" as const, mime: attachment.mime, url })),
                Effect.tapError((cause) => Effect.logError("telegram attachment download failed", { chatId, cause })),
                Effect.option,
              ),
            ).pipe(Effect.map((results) => results.filter((r) => r._tag === "Some").map((r) => r.value)))

            const parts = [...fileParts, ...(text ? [{ type: "text" as const, text }] : [])]
            if (parts.length === 0) return "⚠️ Não consegui baixar o anexo enviado."
            const chatState = (yield* chatSessions.get(chatId)) ?? { directory }
            const model = chatState.subagentModel ?? chatState.model
            const modelParam = model
              ? { providerID: ProviderV2.ID.make(model.providerID), modelID: ModelV2.ID.make(model.modelID) }
              : undefined
            const result = yield* promptSvc.prompt({ sessionID, model: modelParam, parts })
            return extractText(result)
          }).pipe(
            Effect.provideService(InstanceRef, ctx),
            Effect.catch((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError("telegram task failed", { chatId, cause })
                return `⚠️ ${cause instanceof Error ? cause.message : String(cause)}`
              }),
            ),
          )
        }),
      )

      yield* Effect.tryPromise(() => sendMessage(token, chatId, reply || "(sem resposta)")).pipe(Effect.ignore)
    })

    const startTask = Effect.fn("Telegram.startTask")(function* (
      token: string,
      chatId: number,
      directory: string,
      text: string,
      attachments: { fileId: string; mime: string }[],
      // Set only for a request the user chose to run "in parallel" — a
      // fresh child session of its own, since two concurrent turns on the
      // same session would corrupt it. Left undefined, this reuses (or
      // creates once) the chat's persistent session, preserving
      // conversation history the same way it always did before this was
      // backgrounded.
      sessionOverride?: SessionID,
    ) {
      const ctx = yield* instanceStore.load({ directory })
      const sessionID = yield* resolveTaskSessionID(chatId, directory, ctx, sessionOverride)
      rememberSession(chatId, sessionID)
      const running: RunningTask = { sessionID }
      activeTasksByChat.set(chatId, [...(activeTasksByChat.get(chatId) ?? []), running])

      // Runs the request, then keeps draining this chat's queue (if any)
      // in the same forked fiber instead of recursing — each queued item
      // reuses the chat's persistent session (queueing only ever applies
      // to the non-parallel path).
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          let currentSessionID = sessionID
          let currentText = text
          let currentAttachments = attachments
          let currentRunning = running
          while (true) {
            yield* runOneTask(token, chatId, directory, currentSessionID, currentText, currentAttachments, ctx)

            const remaining = (activeTasksByChat.get(chatId) ?? []).filter((item) => item !== currentRunning)
            if (remaining.length > 0) activeTasksByChat.set(chatId, remaining)
            else activeTasksByChat.delete(chatId)

            const queue = queuedTasksByChat.get(chatId)
            if (!queue || queue.length === 0) break
            const [next, ...rest] = queue
            if (rest.length > 0) queuedTasksByChat.set(chatId, rest)
            else queuedTasksByChat.delete(chatId)
            yield* Effect.tryPromise(() =>
              sendMessage(token, chatId, "▶️ Iniciando o próximo pedido da fila..."),
            ).pipe(Effect.ignore)

            currentSessionID = yield* resolveTaskSessionID(chatId, directory, ctx)
            currentText = next.text
            currentAttachments = next.attachments
            currentRunning = { sessionID: currentSessionID }
            activeTasksByChat.set(chatId, [...(activeTasksByChat.get(chatId) ?? []), currentRunning])
          }
        }),
      )
    })

    // Entry point for anything that needs the model: starts immediately if
    // this chat has no task in flight, otherwise asks the user (via
    // buttons) whether to run alongside it or wait — see handleCallbackQuery
    // for the "run:" prefix that resolves that choice.
    const dispatchTask = Effect.fn("Telegram.dispatchTask")(function* (
      token: string,
      chatId: number,
      directory: string,
      text: string,
      attachments: { fileId: string; mime: string }[],
    ) {
      yield* Effect.logInfo("telegram dispatchTask", { chatId, text: text.slice(0, 40) })
      const running = activeTasksByChat.get(chatId)
      yield* Effect.logInfo("telegram dispatchTask: running", { chatId, count: running?.length ?? 0 })
      if (!running || running.length === 0) {
        yield* startTask(token, chatId, directory, text, attachments)
        yield* Effect.logInfo("telegram dispatchTask: startTask returned", { chatId })
        return "🚀 Comecei a trabalhar nisso em segundo plano — te aviso quando terminar."
      }

      const id = String(++runChoiceSeq)
      pendingRunChoices.set(id, { chatId, text, attachments })
      yield* Effect.tryPromise(() =>
        sendMessage(
          token,
          chatId,
          "⏳ Ainda estou processando um pedido anterior pra esse chat. Quer que eu rode este agora, em paralelo, ou só depois que o outro terminar?",
        ),
      ).pipe(Effect.ignore)
      yield* Effect.tryPromise(() => sendRunChoice(token, chatId, id)).pipe(Effect.ignore)
      return undefined
    })

    // Interprets a leading-slash message as a command instead of a prompt.
    // Known meta-commands manage the chat's own state (repo/model/session);
    // anything else forwards to a background subagent task (see
    // dispatchTask) — the exact mechanism the CLI/TUI use for custom skill
    // commands, so any skill available in the connected repo works here for
    // free, without blocking this chat's other commands while it runs.
    const runCommand = Effect.fn("Telegram.runCommand")(function* (
      token: string,
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
        const subagentModel = state.subagentModel
          ? `${state.subagentModel.providerID}/${state.subagentModel.modelID}`
          : "(mesmo de /model)"
        const running = activeTasksByChat.get(chatId)?.length ?? 0
        const queued = queuedTasksByChat.get(chatId)?.length ?? 0
        return [
          `Repositório: ${state.directory}`,
          `Modelo: ${model}`,
          `Modelo do subagent: ${subagentModel}`,
          `Sessão: ${state.sessionID ?? "(nenhuma ainda — a próxima mensagem cria uma)"}`,
          `Tarefas em andamento: ${running}${queued ? ` (+${queued} na fila)` : ""}`,
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
        if (!args.trim()) return yield* listModels("model")
        const rows = Object.values(yield* provider.list()).flatMap((p) =>
          Object.keys(p.models).map((modelID) => ({ providerID: p.id as string, modelID })),
        )
        const index = Number(args.trim()) - 1
        const picked = rows[index]
        if (!picked) return `Modelo inválido. Use /model pra ver a lista.`
        yield* chatSessions.update(chatId, state.directory, (s) => ({ ...s, model: picked }))
        return `Modelo trocado pra ${picked.providerID}/${picked.modelID}.`
      }

      if (command === "model-subagent") {
        if (!args.trim()) return yield* listModels("model-subagent")
        const rows = Object.values(yield* provider.list()).flatMap((p) =>
          Object.keys(p.models).map((modelID) => ({ providerID: p.id as string, modelID })),
        )
        const index = Number(args.trim()) - 1
        const picked = rows[index]
        if (!picked) return `Modelo inválido. Use /model-subagent pra ver a lista.`
        yield* chatSessions.update(chatId, state.directory, (s) => ({ ...s, subagentModel: picked }))
        return `Modelo do subagent trocado pra ${picked.providerID}/${picked.modelID}. (Usado nas tarefas em segundo plano; sem isso, usa o mesmo de /model.)`
      }

      if (command === "skills") {
        return "Digite qualquer comando de skill disponível no repositório (ex: /nome-da-skill) — ele é encaminhado direto pro opencode."
      }

      // Unknown command: forward to the real opencode command pipeline
      // (custom commands / skills), same as the CLI's "/name args" handling
      // — but as a background subagent task (see dispatchTask), not inline,
      // so a long-running skill never blocks this chat's fast commands.
      const fullText = args.trim() ? `/${command} ${args.trim()}` : `/${command}`
      return yield* dispatchTask(token, chatId, state.directory, fullText, [])
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
      yield* Effect.logInfo("telegram handleMessage", { chatId, text: text.slice(0, 40) })

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

      if (yield* tryAnswerPendingQuestion(token, chatId, text)) return

      const state = (yield* chatSessions.get(chatId)) ?? { directory: botDirectory }
      const directory = state.directory

      let reply: string | undefined
      if (text.startsWith("/")) {
        const [command, ...rest] = text.slice(1).split(/\s+/)
        const ctx = yield* instanceStore.load({ directory })
        reply = yield* runCommand(token, chatId, state, command.toLowerCase(), rest.join(" ")).pipe(
          Effect.provideService(InstanceRef, ctx),
        )
      } else {
        reply = yield* dispatchTask(token, chatId, directory, text, attachments)
      }

      yield* Effect.logInfo("telegram handleMessage: reply computed", { chatId, hasReply: !!reply })
      if (reply) yield* Effect.tryPromise(() => sendMessage(token, chatId, reply)).pipe(Effect.ignore)
      yield* Effect.logInfo("telegram handleMessage: done", { chatId })
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
      const data = cb.data ?? ""

      if (data.startsWith("ques:")) {
        const [, requestID, optionIndexStr] = data.split(":")
        const state = requestID ? pendingQuestions.get(requestID) : undefined
        if (!state) {
          yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id)).pipe(Effect.ignore)
          return
        }
        const option = state.questions[state.index]?.options[Number(optionIndexStr)]
        yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id, option?.label)).pipe(Effect.ignore)
        yield* advanceQuestion(token, requestID!, state, [option?.label ?? ""])
        return
      }

      if (data.startsWith("run:")) {
        const [, id, choice] = data.split(":")
        const pending = id ? pendingRunChoices.get(id) : undefined
        if (!pending) {
          yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id)).pipe(Effect.ignore)
          return
        }
        pendingRunChoices.delete(id!)
        if (choice === "parallel") {
          yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id, "Rodando em paralelo")).pipe(Effect.ignore)
          const chatState = (yield* chatSessions.get(pending.chatId)) ?? { directory: "" }
          const parallelCtx = yield* instanceStore.load({ directory: chatState.directory })
          const parentID = chatState.sessionID ? SessionID.make(chatState.sessionID) : undefined
          const child = yield* sessions
            .create({ title: `Telegram (paralelo): ${pending.chatId}`, directory: chatState.directory, parentID })
            .pipe(Effect.provideService(InstanceRef, parallelCtx))
          yield* startTask(token, pending.chatId, chatState.directory, pending.text, pending.attachments, child.id)
          yield* Effect.tryPromise(() =>
            sendMessage(token, pending.chatId, "🚀 Rodando em paralelo — te aviso quando terminar."),
          ).pipe(Effect.ignore)
        } else {
          yield* Effect.tryPromise(() => answerCallbackQuery(token, cb.id, "Enfileirado")).pipe(Effect.ignore)
          const queue = queuedTasksByChat.get(pending.chatId) ?? []
          queuedTasksByChat.set(pending.chatId, [...queue, { text: pending.text, attachments: pending.attachments }])
          yield* Effect.tryPromise(() =>
            sendMessage(token, pending.chatId, "⏳ Enfileirado — vou rodar assim que o pedido atual terminar."),
          ).pipe(Effect.ignore)
        }
        return
      }

      const [, requestID, action] = data.split(":")
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
    // usual approval dialog or an elicitation prompt, so mirror both
    // permission.asked and question.asked for a Telegram-owned session as
    // a message with buttons (questions also accept a free-text reply).
    yield* Effect.forkScoped(
      events.listen((event) =>
        Effect.gen(function* () {
          if (event.type === "permission.asked") {
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
            return
          }
          if (event.type === "question.asked") {
            const request = event.data as Question.Request
            const chatId = sessionChats.get(request.sessionID)
            if (!chatId || request.questions.length === 0) return
            const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
            if (!info || info.type !== "api") return
            pendingQuestions.set(request.id, { chatId, questions: request.questions, index: 0, answers: [] })
            yield* Effect.tryPromise(() => sendQuestion(info.key, chatId, request.id, request.questions[0]!)).pipe(
              Effect.ignore,
            )
          }
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
    Question.node,
    EventV2Bridge.node,
  ],
})
