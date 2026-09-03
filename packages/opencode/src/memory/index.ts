export * as Memory from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigMemoryV1 } from "@opencode-ai/core/v1/config/memory"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "../provider/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { jsonSchema, streamText, tool } from "ai"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

// Extracted from the `breniac` branch's memory feature (commit 96c044467c and
// follow-ups), which was Breniac-voice-exclusive — this makes the same
// global/per-project markdown memory available to any session (chat,
// Telegram, Breniac once it adopts this service too). See issue #138.

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

async function readRecentMemoryFiles(dir: string, count: number) {
  const entries = await readdir(dir).catch(() => [] as string[])
  const files = entries
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .slice(-count)
  const contents = await Promise.all(files.map((file) => readFile(path.join(dir, file), "utf8").catch(() => "")))
  return contents.filter(Boolean).join("\n")
}

function globalDir() {
  return path.join(Global.Path.data, "memory", "global")
}

function projectDir(directory: string) {
  return path.join(Global.Path.data, "memory", "projects", projectKey(directory))
}

export class ModelNotConfiguredError extends Schema.TaggedErrorClass<ModelNotConfiguredError>()(
  "MemoryModelNotConfiguredError",
  {},
) {
  override get message() {
    return "Memory: nenhum modelo de memória configurado (Configurações > Memória)"
  }
}

export class SummarizeFailedError extends Schema.TaggedErrorClass<SummarizeFailedError>()("MemorySummarizeFailedError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Memory: falha ao resumir (${this.reason})`
  }
}

export type SummarizeResult = {
  summarized: boolean
  summary?: string
  suggestsGlobal?: boolean
  globalReason?: string
}

export interface Interface {
  readonly get: () => Effect.Effect<ConfigMemoryV1.Info>
  readonly set: (config: ConfigMemoryV1.Info) => Effect.Effect<ConfigMemoryV1.Info>
  // Summarizes `transcript` with the configured memoryModel and appends the
  // result to this project's memory file. Never writes to global memory on
  // its own — a model-suggested "this is broader than one project" only
  // surfaces as `suggestsGlobal`/`globalReason` for the caller to confirm
  // with the user before calling promoteGlobal.
  readonly summarize: (input: {
    directory: string
    transcript: string
  }) => Effect.Effect<SummarizeResult, ModelNotConfiguredError | SummarizeFailedError>
  // Only call after explicit user confirmation — memory is never promoted
  // to global silently.
  readonly promoteGlobal: (input: { summary: string }) => Effect.Effect<{ path: string }>
  readonly load: (input: { directory?: string }) => Effect.Effect<{ context: string }>
  readonly forgetProject: (directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const layer: Layer.Layer<Service, never, Config.Service | Provider.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<{ config: ConfigMemoryV1.Info }>(
      Effect.fn("Memory.state")(function* () {
        const cfg = yield* cfgSvc.get()
        return { config: cfg.memory ?? {} }
      }),
    )

    const get = Effect.fn("Memory.get")(function* () {
      const s = yield* InstanceState.get(state)
      return s.config
    })

    const set = Effect.fn("Memory.set")(function* (config: ConfigMemoryV1.Info) {
      const s = yield* InstanceState.get(state)
      s.config = config
      yield* cfgSvc.updateGlobal({ memory: config } as ConfigV1.Info)
      return s.config
    })

    const summarize = Effect.fn("Memory.summarize")(function* (input: { directory: string; transcript: string }) {
      if (!input.transcript.trim()) return { summarized: false } satisfies SummarizeResult

      const config = yield* InstanceState.get(state).pipe(Effect.map((s) => s.config))
      if (!config.memoryModel) return yield* new ModelNotConfiguredError()

      const separator = config.memoryModel.indexOf("/")
      const providerID = config.memoryModel.slice(0, separator)
      const modelID = config.memoryModel.slice(separator + 1)
      const providerInfo = yield* provider.getProvider(providerID as any)
      const modelInfo = providerInfo?.models[modelID]
      if (!modelInfo) return yield* new ModelNotConfiguredError()
      const language = yield* provider
        .getLanguage(modelInfo)
        .pipe(Effect.catchTag("ProviderModelNotFoundError", () => Effect.fail(new ModelNotConfiguredError())))

      const saveSummary = tool({
        description: "Salvar o resumo estruturado desta sessão.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Resumo em markdown: decisões, fatos novos, pendências, correções relevantes.",
            },
            generalTopic: {
              type: "boolean",
              description: "true se o conteúdo é de interesse geral do usuário, além deste projeto.",
            },
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
              "Você resume uma sessão de trabalho com o opencode. Foque em: decisões tomadas, fatos novos, " +
              "pendências, e correções que o usuário fez sobre o comportamento do agente. Chame a tool " +
              "save_summary sempre.",
            prompt: input.transcript,
            tools: { save_summary: saveSummary },
            toolChoice: "required",
          })
          return await stream.toolCalls
        },
        catch: (cause) => new SummarizeFailedError({ reason: String(cause) }),
      })

      const call = toolCalls[0]
      if (!call) return yield* new SummarizeFailedError({ reason: "modelo não chamou save_summary" })

      const toolInput = call.input as { summary: string; generalTopic?: boolean; generalReason?: string }
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${toolInput.summary}\n\n`

      const file = path.join(projectDir(input.directory), todayFile())
      yield* Effect.tryPromise({
        try: () => appendMemoryEntry(file, entry),
        catch: (cause) => new SummarizeFailedError({ reason: String(cause) }),
      })

      return {
        summarized: true,
        summary: toolInput.summary,
        suggestsGlobal: toolInput.generalTopic ?? false,
        globalReason: toolInput.generalReason,
      } satisfies SummarizeResult
    })

    const promoteGlobal = Effect.fn("Memory.promoteGlobal")(function* (input: { summary: string }) {
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${input.summary}\n\n`
      const file = path.join(globalDir(), todayFile())
      yield* Effect.tryPromise({ try: () => appendMemoryEntry(file, entry), catch: () => undefined }).pipe(Effect.orDie)
      return { path: file }
    })

    const load = Effect.fn("Memory.load")(function* (input: { directory?: string }) {
      const global = yield* Effect.tryPromise({ try: () => readRecentMemoryFiles(globalDir(), 3), catch: () => "" }).pipe(
        Effect.orElseSucceed(() => ""),
      )
      let project = ""
      if (input.directory) {
        project = yield* Effect.tryPromise({
          try: () => readRecentMemoryFiles(projectDir(input.directory!), 3),
          catch: () => "",
        }).pipe(Effect.orElseSucceed(() => ""))
      }
      return { context: [global, project].filter(Boolean).join("\n\n") }
    })

    const forgetProject = Effect.fn("Memory.forgetProject")(function* (directory: string) {
      yield* Effect.tryPromise({ try: () => rm(projectDir(directory), { recursive: true, force: true }), catch: () => undefined }).pipe(
        Effect.orDie,
      )
    })

    return Service.of({ get, set, summarize, promoteGlobal, load, forgetProject })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node],
})
