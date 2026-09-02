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
type TelegramMessage = { chat: { id: number }; text?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage }
type TelegramGetUpdatesResponse = { ok: true; result: TelegramUpdate[] }

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
      const text = message.text
      if (!text) return
      yield* Effect.tryPromise(() => sendTyping(token, chatId)).pipe(Effect.ignore)

      const state = (yield* chatSessions.get(chatId)) ?? { directory: botDirectory }
      const directory = state.directory
      const ctx = yield* instanceStore.load({ directory })

      const reply = yield* Effect.gen(function* () {
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
        const model = state.model
          ? { providerID: ProviderV2.ID.make(state.model.providerID), modelID: ModelV2.ID.make(state.model.modelID) }
          : undefined
        const result = yield* promptSvc
          .prompt({ sessionID, model, parts: [{ type: "text", text }] })
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
      yield* Effect.tryPromise(() => sendMessage(token, chatId, reply || "(sem resposta)")).pipe(Effect.ignore)
    })

    // Long-poll for the whole server's lifetime, only doing real work while
    // a bot is connected. Sleeps briefly instead of hammering the API when
    // disconnected or between transient errors.
    const pollLoop = Effect.gen(function* () {
      let offset = 0
      while (true) {
        const info = yield* auth.get(TELEGRAM_AUTH_KEY).pipe(Effect.orElseSucceed(() => undefined))
        if (!info || info.type !== "api" || !info.metadata?.directory) {
          yield* Effect.sleep("2 seconds")
          continue
        }
        const token = info.key
        const directory = info.metadata.directory
        const updates = yield* Effect.tryPromise(() => getUpdates(token, offset)).pipe(
          Effect.tapError((cause) => Effect.logError("telegram getUpdates failed", { cause })),
          Effect.catch(() => Effect.sleep("3 seconds").pipe(Effect.as<TelegramUpdate[]>([]))),
        )
        // Telegram never returns instantly with an empty array on a
        // successful poll — an empty result only comes back after the full
        // `timeout=` server-side wait — but this floor guards against ever
        // spinning the loop as fast as the event loop allows if that
        // assumption turns out wrong for some edge case (e.g. a proxy
        // stripping the timeout param).
        if (updates.length === 0) yield* Effect.sleep("1 second")
        for (const update of updates) {
          offset = update.update_id + 1
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
  ],
})
