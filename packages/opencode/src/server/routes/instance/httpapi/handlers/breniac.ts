import { Breniac } from "@/breniac"
import { Provider } from "@/provider/provider"
import type { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { jsonSchema, streamText, tool } from "ai"
import { UpstreamError } from "../errors"
import { InstanceHttpApi } from "../api"
import type { RouteRequest, RouteResponse, SpeakRequest, SpeakResponse, TranscribeRequest } from "../groups/breniac"

// Cloudflare (fronting Omniroute) blocks requests without a browser-like User-Agent.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

export const breniacHandlers = HttpApiBuilder.group(InstanceHttpApi, "breniac", (handlers) =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service
    const provider = yield* Provider.Service

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
      }
      for (const command of ctx.payload.commands) {
        tools[`${APP_COMMAND_TOOL_PREFIX}${command.id}`] = tool({
          description: command.description ? `${command.title} — ${command.description}` : command.title,
          inputSchema: jsonSchema({ type: "object", properties: {} }),
        })
      }

      const toolCalls = yield* Effect.tryPromise({
        try: async () => {
          // O gateway Omniroute sempre responde em streaming (SSE), mesmo sem stream:true —
          // generateText() espera um JSON único e falha com "Invalid JSON response" nele.
          const stream = streamText({
            model: language,
            system:
              "Você roteia um turno de voz do Breniac. Se o texto do usuário corresponder claramente a um dos " +
              "comandos de app disponíveis, chame a tool desse comando. Caso contrário, ou se o texto for um pedido " +
              "de trabalho na sessão de código, chame session_prompt com o texto original.",
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

      return {
        kind: "appCommand",
        commandID: call.toolName.slice(APP_COMMAND_TOOL_PREFIX.length),
      } satisfies RouteResponse
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

    return handlers
      .handle("getConfig", getConfig)
      .handle("setConfig", setConfig)
      .handle("transcribe", transcribe)
      .handle("route", route)
      .handle("speak", speak)
  }),
)
