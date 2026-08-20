import { Breniac } from "@/breniac"
import { Provider } from "@/provider/provider"
import type { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Global } from "@opencode-ai/core/global"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { jsonSchema, streamText, tool } from "ai"
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { UpstreamError } from "../errors"
import { InstanceHttpApi } from "../api"
import { LoadMemoryQuery } from "../groups/breniac"
import type {
  AppendTurnRequest,
  AppendTurnResponse,
  LoadMemoryResponse,
  PromoteGlobalRequest,
  PromoteGlobalResponse,
  RouteRequest,
  RouteResponse,
  SpeakRequest,
  SpeakResponse,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
} from "../groups/breniac"

function projectKey(directory: string) {
  return directory.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(-80) || "root"
}

function todayFile() {
  return `${new Date().toISOString().slice(0, 10)}.md`
}

async function appendMemoryEntry(file: string, entry: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const existing = await readFile(file, "utf8").catch(() => "")
  await writeFile(file, existing + entry, "utf8")
}

const TMP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// Roda uma vez por startup do servidor (não precisa de scheduler dedicado): apaga
// arquivos temporários de conversa cujo resumo foi concluído há mais de 7 dias.
async function cleanupExpiredTmpFiles() {
  const dir = path.join(Global.Path.data, "breniac", "tmp")
  const entries = await readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.endsWith(".summarized")) continue
    const markerPath = path.join(dir, entry)
    const timestamp = await readFile(markerPath, "utf8").catch(() => "")
    const summarizedAt = Date.parse(timestamp)
    if (Number.isNaN(summarizedAt) || now - summarizedAt < TMP_RETENTION_MS) continue
    const base = entry.slice(0, -".summarized".length)
    await Promise.all([unlink(markerPath).catch(() => {}), unlink(path.join(dir, `${base}.md`)).catch(() => {})])
  }
}

async function readRecentMemoryFiles(dir: string, count: number) {
  const entries = await readdir(dir).catch(() => [] as string[])
  const files = entries.filter((entry) => entry.endsWith(".md")).sort().slice(-count)
  const contents = await Promise.all(
    files.map((file) => readFile(path.join(dir, file), "utf8").catch(() => "")),
  )
  return contents.filter(Boolean).join("\n")
}

// Cloudflare (fronting Omniroute) blocks requests without a browser-like User-Agent.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

export const breniacHandlers = HttpApiBuilder.group(InstanceHttpApi, "breniac", (handlers) =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service
    const provider = yield* Provider.Service

    yield* Effect.tryPromise({ try: cleanupExpiredTmpFiles, catch: () => undefined }).pipe(Effect.ignore)

    const getConfig = Effect.fn("BreniacHttpApi.getConfig")(function* () {
      return yield* breniac.get()
    })

    const setConfig = Effect.fn("BreniacHttpApi.setConfig")(function* (ctx: { payload: ConfigBreniacV1.Info }) {
      return yield* breniac.set(ctx.payload)
    })

    const transcribe = Effect.fn("BreniacHttpApi.transcribe")(function* (ctx: { payload: TranscribeRequest }) {
      const config = yield* breniac.get()
      if (!config.transcriptionModel)
        return yield* Effect.fail(
          new UpstreamError({ message: "Breniac: transcriptionModel não configurado", service: "breniac" }),
        )

      const separator = config.transcriptionModel.indexOf("/")
      const providerID = config.transcriptionModel.slice(0, separator)
      const modelID = config.transcriptionModel.slice(separator + 1)

      const providerInfo = yield* provider.getProvider(providerID as any)
      const baseURL = String(providerInfo.options["baseURL"] ?? "").replace(/\/$/, "")
      const apiKey = providerInfo.key

      const bytes = Uint8Array.from(atob(ctx.payload.audio), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append("model", modelID)
      form.append("file", new Blob([bytes], { type: ctx.payload.mimeType }), "turn.webm")

      const res = yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseURL}/audio/transcriptions`, {
            method: "POST",
            headers: {
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              "User-Agent": BROWSER_USER_AGENT,
            },
            body: form,
          }),
        catch: () => new UpstreamError({ message: "Breniac: falha ao chamar o endpoint de transcrição", service: "breniac" }),
      })

      if (!res.ok) {
        const body = yield* Effect.tryPromise({ try: () => res.text(), catch: () => "" }).pipe(Effect.orElseSucceed(() => ""))
        return yield* Effect.fail(
          new UpstreamError({
            message: `Breniac: transcrição falhou (${res.status}): ${body}`,
            service: "breniac",
            status: res.status,
          }),
        )
      }

      const json = yield* Effect.tryPromise({
        try: () => res.json() as Promise<{ text?: string }>,
        catch: () => new UpstreamError({ message: "Breniac: resposta de transcrição inválida", service: "breniac" }),
      })

      return { text: json.text ?? "" }
    })

    const route = Effect.fn("BreniacHttpApi.route")(function* (ctx: { payload: RouteRequest }) {
      const config = yield* breniac.get()
      if (!config.providerID)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: providerID não configurado", service: "breniac" }))

      const small = yield* provider.getSmallModel(config.providerID as any)
      const model =
        small ??
        (yield* provider.getProvider(config.providerID as any).pipe(
          Effect.map((info) => {
            const models = Object.values(info?.models ?? {})
            // Prefer well-known routing prefixes (openrouter/kc) validated against this gateway;
            // exotic aggregator prefixes (e.g. "agy/") have proven unreliable for tool-calling.
            const preferred = [
              "openrouter/openai/gpt-4o-mini",
              "openrouter/google/gemini-3.5-flash-lite",
              "kc/google/gemini-3.5-flash-lite",
              "openrouter/anthropic/claude-haiku",
            ]
            for (const id of preferred) {
              const match = models.find((m) => m.id === id)
              if (match) return match
            }
            const fallback = models.find((m) => m.id.startsWith("openrouter/") || m.id.startsWith("kc/"))
            return fallback ?? models[0]
          }),
        ))
      if (!model)
        return yield* Effect.fail(
          new UpstreamError({ message: "Breniac: nenhum modelo disponível pro provider configurado", service: "breniac" }),
        )
      const language = yield* provider
        .getLanguage(model)
        .pipe(
          Effect.catchTag("ProviderModelNotFoundError", (cause) =>
            Effect.fail(
              new UpstreamError({ message: `Breniac: modelo de roteamento não encontrado (${cause.modelID})`, service: "breniac" }),
            ),
          ),
        )

      const APP_COMMAND_TOOL_PREFIX = "app_command_"
      const tools: Record<string, ReturnType<typeof tool>> = {
        session_prompt: tool({
          description: "Enviar o texto como um prompt de sessão de chat normal (não é um comando conhecido do app).",
          inputSchema: jsonSchema({
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          }),
        }),
        answer_directly: tool({
          description:
            "Responder diretamente por voz, sem executar nada — use pra perguntas sobre o app/tela atual " +
            "(ex.: 'em que tela estamos?'), sobre o conteúdo da última resposta do agente na sessão (quando " +
            "fornecido no contexto), conversa/brainstorm, ou qualquer coisa que não seja nem um comando de app " +
            "nem um pedido de trabalho NOVO pra sessão. Se não tiver a informação no contexto fornecido, diga que " +
            "não tem acesso a isso — nunca invente que leu algo que não foi passado a você.",
          inputSchema: jsonSchema({
            type: "object",
            properties: { answer: { type: "string", description: "Resposta curta e natural, pronta pra ser falada." } },
            required: ["answer"],
          }),
        }),
      }
      // Nomes de tool só podem conter [a-zA-Z0-9_-] pra maioria dos provedores de
      // function-calling — command IDs reais (ex.: "breniac.openProject:D:/dev/x")
      // têm ":"/"/" e quebram a chamada inteira ("No output generated") se usados
      // direto. Sanitiza e mantém um mapa de volta pro ID real.
      const toolNameToCommandID: Record<string, string> = {}
      ctx.payload.commands.forEach((command, index) => {
        const toolName = `${APP_COMMAND_TOOL_PREFIX}${index}_${command.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`
        toolNameToCommandID[toolName] = command.id
        tools[toolName] = tool({
          description: command.description ? `${command.title} — ${command.description}` : command.title,
          inputSchema: jsonSchema({ type: "object", properties: {} }),
        })
      })

      const toolCalls = yield* Effect.tryPromise({
        try: async () => {
          // O gateway Omniroute sempre responde em streaming (SSE), mesmo sem stream:true —
          // generateText() espera um JSON único e falha com "Invalid JSON response" nele.
          const stream = streamText({
            model: language,
            system:
              "Você é o Breniac, o assistente de voz colaborador do opencode (um fork do editor de código com " +
              "agentes de IA). Você roteia um turno de voz: se o texto do usuário corresponder claramente a um dos " +
              "comandos de app disponíveis (ex.: abrir um projeto específico, criar sessão), chame a tool desse " +
              "comando. Se for um pedido de trabalho na sessão de código (ex.: 'roda os testes', 'corrige esse bug'), " +
              "chame session_prompt com o texto original. Caso contrário — pergunta sobre o app/tela atual, papo, " +
              "brainstorm, ou qualquer coisa que não seja nem comando nem trabalho de código — chame answer_directly. " +
              "IMPORTANTE: só afirme ter lido/analisado algo se essa informação estiver literalmente presente no " +
              "contexto abaixo — nunca finja ter acesso ao que não foi fornecido." +
              (ctx.payload.currentScreen ? `\n\nTela atual do app: ${ctx.payload.currentScreen}` : "") +
              (ctx.payload.sessionContext
                ? `\n\nÚltima resposta do agente na sessão ativa (isso é tudo que você viu dela):\n${ctx.payload.sessionContext}`
                : "") +
              (ctx.payload.memoryContext
                ? `\n\nMemória recente de conversas anteriores (use como contexto, não repita de volta):\n${ctx.payload.memoryContext}`
                : ""),
            prompt: ctx.payload.text,
            tools,
            toolChoice: "required",
          })
          return await stream.toolCalls
        },
        catch: (cause) => new UpstreamError({ message: `Breniac: falha no roteamento (${String(cause)})`, service: "breniac" }),
      })

      const call = toolCalls[0]
      if (!call)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: roteador não decidiu nada", service: "breniac" }))

      if (call.toolName === "session_prompt") {
        const input = call.input as { text?: string }
        return { kind: "sessionPrompt", prompt: input.text ?? ctx.payload.text } satisfies RouteResponse
      }

      if (call.toolName === "answer_directly") {
        const input = call.input as { answer?: string }
        return { kind: "answer", answer: input.answer ?? "" } satisfies RouteResponse
      }

      const commandID = toolNameToCommandID[call.toolName]
      if (!commandID)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: comando de app não reconhecido", service: "breniac" }))

      return { kind: "appCommand", commandID } satisfies RouteResponse
    })

    const speak = Effect.fn("BreniacHttpApi.speak")(function* (ctx: { payload: SpeakRequest }) {
      const config = yield* breniac.get()
      if (!config.audioModel)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: audioModel não configurado", service: "breniac" }))

      const separator = config.audioModel.indexOf("/")
      const providerID = config.audioModel.slice(0, separator)
      const modelID = config.audioModel.slice(separator + 1)

      const providerInfo = yield* provider.getProvider(providerID as any)
      const baseURL = String(providerInfo.options["baseURL"] ?? "").replace(/\/$/, "")
      const apiKey = providerInfo.key

      const res = yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              "User-Agent": BROWSER_USER_AGENT,
            },
            body: JSON.stringify({
              model: modelID,
              modalities: ["text", "audio"],
              // pcm16 é o único formato de saída suportado pelo gateway pra esse modelo
              // (mp3/opus/aac/flac/wav retornam "unsupported_value" da OpenAI).
              audio: { voice: "alloy", format: "pcm16" },
              messages: [{ role: "user", content: ctx.payload.text }],
              stream: true,
            }),
          }),
        catch: () => new UpstreamError({ message: "Breniac: falha ao chamar o modelo de áudio", service: "breniac" }),
      })

      if (!res.ok || !res.body) {
        const body = yield* Effect.tryPromise({ try: () => res.text(), catch: () => "" }).pipe(
          Effect.orElseSucceed(() => ""),
        )
        return yield* Effect.fail(
          new UpstreamError({ message: `Breniac: resposta em áudio falhou (${res.status}): ${body}`, service: "breniac", status: res.status }),
        )
      }

      const chunks = yield* Effect.tryPromise({
        try: async () => {
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          const audioChunks: Uint8Array[] = []
          let buffer = ""
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith("data:")) continue
              const payload = trimmed.slice("data:".length).trim()
              if (payload === "[DONE]") continue
              try {
                const json = JSON.parse(payload)
                const audio = json.choices?.[0]?.delta?.audio?.data
                if (typeof audio === "string") audioChunks.push(Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)))
              } catch {
                // linha SSE incompleta ou não-JSON — ignora
              }
            }
          }
          return audioChunks
        },
        catch: () => new UpstreamError({ message: "Breniac: falha ao ler o stream de áudio", service: "breniac" }),
      })

      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      let binary = ""
      for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]!)

      return { audio: btoa(binary), sampleRate: 24000, channels: 1 } satisfies SpeakResponse
    })

    const appendTurn = Effect.fn("BreniacHttpApi.appendTurn")(function* (ctx: { payload: AppendTurnRequest }) {
      const safeID = ctx.payload.voiceSessionID.replace(/[^a-zA-Z0-9_-]/g, "_")
      if (!safeID)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: voiceSessionID inválido", service: "breniac" }))

      const dir = path.join(Global.Path.data, "breniac", "tmp")
      const file = path.join(dir, `${safeID}.md`)

      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dir, { recursive: true })
          const timestamp = new Date().toISOString()
          const entry =
            `## ${timestamp}\n\n` +
            `**Usuário:** ${ctx.payload.transcript}\n\n` +
            `**Breniac:** ${ctx.payload.response}\n\n`
          const existing = await readFile(file, "utf8").catch(() => "")
          await writeFile(file, existing + entry, "utf8")
        },
        catch: () => new UpstreamError({ message: "Breniac: falha ao gravar o arquivo temporário", service: "breniac" }),
      })

      return { path: file } satisfies AppendTurnResponse
    })

    const summarize = Effect.fn("BreniacHttpApi.summarize")(function* (ctx: { payload: SummarizeRequest }) {
      const safeID = ctx.payload.voiceSessionID.replace(/[^a-zA-Z0-9_-]/g, "_")
      const tmpFile = path.join(Global.Path.data, "breniac", "tmp", `${safeID}.md`)
      const transcript = yield* Effect.tryPromise({
        try: () => readFile(tmpFile, "utf8"),
        catch: () => new UpstreamError({ message: "", service: "breniac" }),
      }).pipe(Effect.orElseSucceed(() => ""))

      if (!transcript.trim()) return { summarized: false } satisfies SummarizeResponse

      const config = yield* breniac.get()
      if (!config.memoryModel)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: memoryModel não configurado", service: "breniac" }))

      const separator = config.memoryModel.indexOf("/")
      const providerID = config.memoryModel.slice(0, separator)
      const modelID = config.memoryModel.slice(separator + 1)
      const providerInfo = yield* provider.getProvider(providerID as any)
      const modelInfo = providerInfo?.models[modelID]
      if (!modelInfo)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: modelo de memória não encontrado", service: "breniac" }))
      const language = yield* provider
        .getLanguage(modelInfo)
        .pipe(
          Effect.catchTag("ProviderModelNotFoundError", () =>
            Effect.fail(new UpstreamError({ message: "Breniac: modelo de memória não encontrado", service: "breniac" })),
          ),
        )

      const saveSummary = tool({
        description: "Salvar o resumo estruturado desta sessão de voz.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            summary: { type: "string", description: "Resumo em markdown: decisões, fatos novos, pendências, correções feitas no Breniac." },
            generalTopic: { type: "boolean", description: "true se o conteúdo é de interesse geral do usuário, além deste projeto." },
            generalReason: { type: "string", description: "Por que isso poderia interessar à memória global, se generalTopic=true." },
          },
          required: ["summary", "generalTopic"],
        }),
      })

      const toolCalls = yield* Effect.tryPromise({
        try: async () => {
          const stream = streamText({
            model: language,
            system:
              "Você resume uma sessão de voz do Breniac (colaborador de voz do opencode). Foque em: decisões tomadas, " +
              "fatos novos, pendências, e principalmente correções que o usuário fez no próprio Breniac durante a " +
              "conversa. Chame a tool save_summary sempre.",
            prompt: transcript,
            tools: { save_summary: saveSummary },
            toolChoice: "required",
          })
          return await stream.toolCalls
        },
        catch: (cause) => new UpstreamError({ message: `Breniac: falha ao resumir (${String(cause)})`, service: "breniac" }),
      })

      const call = toolCalls[0]
      if (!call)
        return yield* Effect.fail(new UpstreamError({ message: "Breniac: resumo não gerado", service: "breniac" }))

      const input = call.input as { summary: string; generalTopic?: boolean; generalReason?: string }
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${input.summary}\n\n`

      const key = projectKey(ctx.payload.directory)
      const projectFile = path.join(Global.Path.data, "breniac", "memory", "projects", key, todayFile())
      yield* Effect.tryPromise({
        try: () => appendMemoryEntry(projectFile, entry),
        catch: () => new UpstreamError({ message: "Breniac: falha ao gravar a memória do projeto", service: "breniac" }),
      })

      // Marca o arquivo temporário como resumido — a expiração (7 dias) conta a partir daqui.
      const safeIDForMarker = ctx.payload.voiceSessionID.replace(/[^a-zA-Z0-9_-]/g, "_")
      yield* Effect.tryPromise({
        try: () =>
          writeFile(
            path.join(Global.Path.data, "breniac", "tmp", `${safeIDForMarker}.summarized`),
            new Date().toISOString(),
            "utf8",
          ),
        catch: () => new UpstreamError({ message: "", service: "breniac" }),
      }).pipe(Effect.ignore)

      return {
        summarized: true,
        summary: input.summary,
        suggestsGlobal: input.generalTopic ?? false,
        globalReason: input.generalReason,
      } satisfies SummarizeResponse
    })

    const promoteGlobal = Effect.fn("BreniacHttpApi.promoteGlobal")(function* (ctx: { payload: PromoteGlobalRequest }) {
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${ctx.payload.summary}\n\n`
      const globalFile = path.join(Global.Path.data, "breniac", "memory", "global", todayFile())
      yield* Effect.tryPromise({
        try: () => appendMemoryEntry(globalFile, entry),
        catch: () => new UpstreamError({ message: "Breniac: falha ao gravar a memória global", service: "breniac" }),
      })
      return { path: globalFile } satisfies PromoteGlobalResponse
    })

    const loadMemory = Effect.fn("BreniacHttpApi.loadMemory")(function* (ctx: {
      query: Schema.Schema.Type<typeof LoadMemoryQuery>
    }) {
      const globalDir = path.join(Global.Path.data, "breniac", "memory", "global")
      const globalContext = yield* Effect.tryPromise({
        try: () => readRecentMemoryFiles(globalDir, 3),
        catch: () => new UpstreamError({ message: "", service: "breniac" }),
      }).pipe(Effect.orElseSucceed(() => ""))

      let projectContext = ""
      if (ctx.query.projectDirectory) {
        const key = projectKey(ctx.query.projectDirectory)
        const projectDir = path.join(Global.Path.data, "breniac", "memory", "projects", key)
        projectContext = yield* Effect.tryPromise({
          try: () => readRecentMemoryFiles(projectDir, 3),
          catch: () => new UpstreamError({ message: "", service: "breniac" }),
        }).pipe(Effect.orElseSucceed(() => ""))
      }

      const context = [globalContext, projectContext].filter(Boolean).join("\n\n")
      return { context } satisfies LoadMemoryResponse
    })

    return handlers
      .handle("getConfig", getConfig)
      .handle("setConfig", setConfig)
      .handle("transcribe", transcribe)
      .handle("route", route)
      .handle("speak", speak)
      .handle("appendTurn", appendTurn)
      .handle("summarize", summarize)
      .handle("promoteGlobal", promoteGlobal)
      .handle("loadMemory", loadMemory)
  }),
)
