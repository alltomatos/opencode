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

// Memory is on by default (opt-out, not opt-in) — unset `enabled` means
// "never touched this setting," which should behave as enabled; only an
// explicit `false` (the user turned it off in Settings) disables it.
export function isEnabled(config: ConfigMemoryV1.Info) {
  return config.enabled !== false
}

// Curated against the Omniroute catalog (same list used by the Breniac
// recommended-models dialog) — cheap/fast models that have proven reliable
// for structured tool-calling. Tried in order; the first one whose provider
// is actually connected wins, so a fresh install gets a working default
// without the user having to configure anything first.
const DEFAULT_MODEL_CANDIDATES = [
  "openrouter/google/gemini-3.5-flash-lite",
  "kc/anthropic/claude-haiku-4.5",
  "kc/google/gemini-2.5-flash-lite",
  "antigravity/gemini-3.1-flash-lite",
  "agy/gemini-3.1-flash-lite",
]

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

// Where the global-memory skill lives so it's picked up by the same discovery
// mechanism as any other skill (packages/opencode/src/skill/index.ts scans
// Global.Path.config with the "{skill,skills}/**/SKILL.md" pattern) — this is
// what makes global memory available in every session without per-consumer
// wiring, on top of the explicit Memory.Service.load() used by
// sessions/Telegram. See issue #142.
function globalSkillFile() {
  return path.join(Global.Path.config, "skill", "memory", "SKILL.md")
}

// Caps how much global-memory content gets embedded in the skill file so it
// can't grow unbounded — only the most recent entries survive a
// regeneration; older ones stay on disk under memory/global/ (readable via
// the memory_search tool / Memory.Service.load()) but drop out of the skill.
const GLOBAL_SKILL_MAX_CHARS = 20_000
const GLOBAL_SKILL_MAX_FILES = 20

async function regenerateGlobalSkillFile() {
  const content = await readRecentMemoryFiles(globalDir(), GLOBAL_SKILL_MAX_FILES)
  const trimmed = content.length > GLOBAL_SKILL_MAX_CHARS ? content.slice(-GLOBAL_SKILL_MAX_CHARS) : content
  const body = trimmed.trim()
    ? trimmed
    : "Nenhuma memória global registrada ainda."
  const skill =
    `---\n` +
    `name: memory\n` +
    `description: Memória global entre sessões e projetos — fatos, preferências e decisões que o usuário confirmou como relevantes além de um projeto específico. Consulte antes de perguntar algo que já pode ter sido respondido antes.\n` +
    `---\n\n` +
    `${body}\n`
  const file = globalSkillFile()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, skill, "utf8")
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
  // Direct write, no secondary LLM call — for the on-demand `memory_save`
  // tool, where the model already doing the work decides something is
  // worth remembering. Project-scoped only; promoting to global still goes
  // through the explicit-confirmation summarize()/promoteGlobal() path.
  readonly remember: (input: { directory: string; note: string }) => Effect.Effect<{ path: string }>
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

    // Resolves a "providerID/modelID" string to an actual, connected model —
    // used both for the user's explicit choice and for auto-picking a
    // default from DEFAULT_MODEL_CANDIDATES.
    const tryResolveModel = (spec: string) =>
      Effect.gen(function* () {
        const separator = spec.indexOf("/")
        if (separator < 0) return undefined
        const providerID = spec.slice(0, separator)
        const modelID = spec.slice(separator + 1)
        const providerInfo = yield* provider.getProvider(providerID as any).pipe(Effect.orElseSucceed(() => undefined))
        const modelInfo = providerInfo?.models[modelID]
        if (!modelInfo) return undefined
        return yield* provider
          .getLanguage(modelInfo)
          .pipe(Effect.catchTag("ProviderModelNotFoundError", () => Effect.succeed(undefined)))
      })

    const resolveModel = Effect.fn("Memory.resolveModel")(function* (configured: string | undefined) {
      if (configured) {
        const language = yield* tryResolveModel(configured)
        if (language) return language
        return yield* new ModelNotConfiguredError()
      }
      for (const candidate of DEFAULT_MODEL_CANDIDATES) {
        const language = yield* tryResolveModel(candidate)
        if (language) return language
      }
      return yield* new ModelNotConfiguredError()
    })

    const summarize = Effect.fn("Memory.summarize")(function* (input: { directory: string; transcript: string }) {
      if (!input.transcript.trim()) return { summarized: false } satisfies SummarizeResult

      const config = yield* InstanceState.get(state).pipe(Effect.map((s) => s.config))
      const language = yield* resolveModel(config.memoryModel)

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

    const remember = Effect.fn("Memory.remember")(function* (input: { directory: string; note: string }) {
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${input.note}\n\n`
      const file = path.join(projectDir(input.directory), todayFile())
      yield* Effect.tryPromise({ try: () => appendMemoryEntry(file, entry), catch: () => undefined }).pipe(Effect.orDie)
      return { path: file }
    })

    const promoteGlobal = Effect.fn("Memory.promoteGlobal")(function* (input: { summary: string }) {
      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${input.summary}\n\n`
      const file = path.join(globalDir(), todayFile())
      yield* Effect.tryPromise({ try: () => appendMemoryEntry(file, entry), catch: () => undefined }).pipe(Effect.orDie)
      yield* Effect.tryPromise({ try: () => regenerateGlobalSkillFile(), catch: () => undefined }).pipe(Effect.orDie)
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

    return Service.of({ get, set, summarize, promoteGlobal, load, forgetProject, remember })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node],
})
