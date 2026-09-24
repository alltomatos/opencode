export * as Memory from "./index"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigMemoryV1 } from "@opencode-ai/core/v1/config/memory"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "../provider/provider"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createAntigravityFetch, getLiveToken } from "../provider/antigravity-adapter"
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
  "google-antigravity/gemini-3.7-flash-low",
  "google-antigravity/gemini-3.1-flash-lite",
  "google-antigravity-cli/gemini-3.7-flash-low",
  "google-antigravity-cli/gemini-3.1-flash-lite",
  "openrouter/google/gemini-2.5-flash",
  "openrouter/meta-llama/llama-3.3-70b-instruct",
  "openrouter/deepseek/deepseek-chat",
  "openrouter/anthropic/claude-3.5-haiku",
  "omnrt/agy/gemini-3.7-flash-low",
  "omnrt/google/gemini-2.5-flash",
  "agentrouter/glm-5.3",
  "kc/anthropic/claude-haiku-4.5",
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

export type BackfillResult = {
  totalSessions: number
  processedSessions: number
  summarizedSessions: number
  projectsCount: number
  errors: string[]
}

function buildTranscript(messages: SessionV1.WithParts[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.info.role === "user" ? "Usuário" : "Assistente"
    const textParts: string[] = []
    for (const part of msg.parts) {
      if ("text" in part && typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text.trim())
      } else if (part.type === "tool" && "tool" in part) {
        textParts.push(`[Chamou ferramenta: ${part.tool}]`)
      } else if (part.type === "patch" && "file" in part) {
        textParts.push(`[Alterou arquivo: ${part.file}]`)
      }
    }
    if (textParts.length > 0) {
      lines.push(`${role}: ${textParts.join("\n")}`)
    }
  }
  return lines.join("\n\n")
}

function extractHeuristicSummary(transcript: string): string {
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean)
  const keyPoints: string[] = []
  for (const line of lines) {
    if (line.startsWith("Usuário:") || line.startsWith("User:")) {
      const clean = line.replace(/^(Usuário|User):\s*/, "").slice(0, 200)
      if (clean.length > 5) keyPoints.push(`- **Pedido/Discussão**: ${clean}`)
    } else if (line.startsWith("[Alterou arquivo:")) {
      keyPoints.push(`- **Alteração**: ${line}`)
    }
  }
  return keyPoints.slice(0, 8).join("\n") || "- Registro automático da sessão."
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
  // Scans previous sessions across projects and synthesizes missing memories
  // into project memory files using the available fallback model.
  readonly backfill: (input?: {
    directory?: string
    sessionID?: string
  }) => Effect.Effect<BackfillResult>
  // Only call after explicit user confirmation — memory is never promoted
  // to global silently.
  readonly promoteGlobal: (input: { summary: string }) => Effect.Effect<{ path: string }>
  readonly load: (input: { directory?: string }) => Effect.Effect<{ context: string }>
  readonly loadProject: (directory: string) => Effect.Effect<{ content: string }>
  readonly loadGlobal: () => Effect.Effect<{ content: string }>
  readonly forgetProject: (directory: string) => Effect.Effect<void>
  // Used to decide whether closing a project should even ask about
  // forgetting its memory — no memory recorded means no dialog, no
  // friction. See issue #141.
  readonly hasProjectMemory: (directory: string) => Effect.Effect<boolean>
  // Direct write, no secondary LLM call — for the on-demand `memory_save`
  // tool, where the model already doing the work decides something is
  // worth remembering. Project-scoped only; promoting to global still goes
  // through the explicit-confirmation summarize()/promoteGlobal() path.
  readonly remember: (input: { directory: string; note: string }) => Effect.Effect<{ path: string }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const layer: Layer.Layer<Service, never, Config.Service | Provider.Service | Session.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service

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
        if (providerID === "opencode" && (modelID.includes("free") || modelID.includes("lightning"))) {
          return undefined
        }
        if (providerID === "google-antigravity" || providerID === "google-antigravity-cli") {
          const profile: "ide" | "cli" = providerID === "google-antigravity-cli" ? "cli" : "ide"
          const integrationID = profile === "cli" ? "google-antigravity-cli" : "google-antigravity"
          const live = yield* Effect.tryPromise(() => getLiveToken(integrationID, profile)).pipe(
            Effect.orElseSucceed(() => undefined),
          )
          if (!live || live.exhausted || !live.token) return undefined
          try {
            const google = createGoogleGenerativeAI({
              apiKey: "antigravity-oauth",
              baseURL: "https://daily-cloudcode-pa.googleapis.com/v1internal",
              fetch: createAntigravityFetch(profile) as any,
            })
            return google.languageModel(modelID)
          } catch {
            return undefined
          }
        }
        const modelInfo = yield* provider
          .getModel(providerID as any, modelID as any)
          .pipe(Effect.orElseSucceed(() => undefined))
        if (!modelInfo) return undefined
        return yield* provider
          .getLanguage(modelInfo)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
      })

    const resolveModelCandidates = Effect.fn("Memory.resolveModelCandidates")(function* (configured: string | undefined) {
      yield* provider.list().pipe(Effect.orElseSucceed(() => ({})))
      const result: any[] = []
      const seen = new Set<string>()

      if (configured && configured.trim()) {
        const language = yield* tryResolveModel(configured.trim())
        if (language) {
          result.push(language)
          seen.add(configured.trim())
        }
      }

      for (const candidate of DEFAULT_MODEL_CANDIDATES) {
        if (seen.has(candidate)) continue
        const language = yield* tryResolveModel(candidate)
        if (language) {
          result.push(language)
          seen.add(candidate)
        }
      }

      const defaultMod = yield* provider.defaultModel().pipe(Effect.orElseSucceed(() => undefined))
      if (defaultMod) {
        const key = `${defaultMod.providerID}/${defaultMod.modelID}`
        if (!seen.has(key)) {
          const language = yield* tryResolveModel(key)
          if (language) {
            result.push(language)
            seen.add(key)
          }
        }
      }

      const providersList = yield* provider.list().pipe(Effect.orElseSucceed(() => ({})))
      for (const p of Object.values(providersList)) {
        if (p.id === "opencode") continue
        for (const m of Object.values(p.models)) {
          const key = `${p.id}/${m.id}`
          if (seen.has(key)) continue
          const language = yield* tryResolveModel(key)
          if (language) {
            result.push(language)
            seen.add(key)
          }
        }
      }

      return result
    })

    const resolveModel = Effect.fn("Memory.resolveModel")(function* (configured: string | undefined) {
      const candidates = yield* resolveModelCandidates(configured)
      if (candidates.length > 0) return candidates[0]
      return yield* new ModelNotConfiguredError()
    })

    const summarize = Effect.fn("Memory.summarize")(function* (input: { directory: string; transcript: string }) {
      if (!input.transcript.trim()) return { summarized: false } satisfies SummarizeResult

      const config = yield* InstanceState.get(state).pipe(Effect.map((s) => s.config))
      const candidates = yield* resolveModelCandidates(config.memoryModel)

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
          if (candidates.length === 0) return []
          for (const language of candidates) {
            try {
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
              const calls = await stream.toolCalls
              if (calls && calls.length > 0) {
                return calls
              }
            } catch {
              // Continua para o próximo candidato
            }
          }
          return []
        },
        catch: (cause) => new SummarizeFailedError({ reason: String(cause) }),
      }).pipe(Effect.orElseSucceed(() => []))

      const call = toolCalls[0]
      let summaryText: string
      let suggestsGlobal = false
      let globalReason: string | undefined

      if (call) {
        const toolInput = call.input as { summary: string; generalTopic?: boolean; generalReason?: string }
        summaryText = toolInput.summary
        suggestsGlobal = toolInput.generalTopic ?? false
        globalReason = toolInput.generalReason
      } else {
        summaryText = extractHeuristicSummary(input.transcript)
      }

      const timestamp = new Date().toISOString()
      const entry = `## ${timestamp}\n\n${summaryText}\n\n`

      const file = path.join(projectDir(input.directory), todayFile())
      yield* Effect.tryPromise({
        try: () => appendMemoryEntry(file, entry),
        catch: (cause) => new SummarizeFailedError({ reason: String(cause) }),
      })

      return {
        summarized: true,
        summary: summaryText,
        suggestsGlobal,
        globalReason,
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

    const loadProject = Effect.fn("Memory.loadProject")(function* (directory: string) {
      const content = yield* Effect.tryPromise({
        try: () => readRecentMemoryFiles(projectDir(directory), 30),
        catch: () => "",
      }).pipe(Effect.orElseSucceed(() => ""))
      return { content }
    })

    const loadGlobal = Effect.fn("Memory.loadGlobal")(function* () {
      const content = yield* Effect.tryPromise({
        try: () => readRecentMemoryFiles(globalDir(), 30),
        catch: () => "",
      }).pipe(Effect.orElseSucceed(() => ""))
      return { content }
    })

    const forgetProject = Effect.fn("Memory.forgetProject")(function* (directory: string) {
      yield* Effect.tryPromise({ try: () => rm(projectDir(directory), { recursive: true, force: true }), catch: () => undefined }).pipe(
        Effect.orDie,
      )
    })

    const hasProjectMemory = Effect.fn("Memory.hasProjectMemory")(function* (directory: string) {
      const entries = yield* Effect.tryPromise({ try: () => readdir(projectDir(directory)), catch: () => [] as string[] }).pipe(
        Effect.orElseSucceed(() => [] as string[]),
      )
      return entries.some((entry) => entry.endsWith(".md"))
    })

    const backfill = Effect.fn("Memory.backfill")(function* (input?: {
      directory?: string
      sessionID?: string
    }) {
      const sessionList = yield* sessions.listGlobal().pipe(Effect.orElseSucceed(() => []))
      let targets = sessionList.filter((s) => !s.parentID)
      if (input?.directory) {
        targets = targets.filter((s) => s.directory === input.directory)
      }
      if (input?.sessionID) {
        targets = targets.filter((s) => s.id === input.sessionID)
      }

      const totalSessions = targets.length
      let processedSessions = 0
      let summarizedSessions = 0
      const projects = new Set<string>()
      const errors: string[] = []

      for (const s of targets) {
        processedSessions++
        if (s.directory) projects.add(s.directory)
        const msgs = yield* sessions.messages({ sessionID: s.id as any }).pipe(Effect.orElseSucceed(() => []))
        if (msgs.length === 0) continue

        const transcript = buildTranscript(msgs)
        if (transcript.length < 50) continue

        const res: SummarizeResult = yield* summarize({ directory: s.directory, transcript }).pipe(
          Effect.catch((err) => {
            errors.push(`Sessão ${s.id}: ${err instanceof Error ? err.message : String(err)}`)
            return Effect.succeed({ summarized: false } satisfies SummarizeResult)
          }),
        )

        if (res.summarized) {
          summarizedSessions++
          if (res.suggestsGlobal && res.summary) {
            yield* promoteGlobal({ summary: res.summary }).pipe(Effect.ignore)
          }
        }
      }

      return {
        totalSessions,
        processedSessions,
        summarizedSessions,
        projectsCount: projects.size,
        errors,
      }
    })

    return Service.of({
      get,
      set,
      summarize,
      backfill,
      promoteGlobal,
      load,
      loadProject,
      loadGlobal,
      forgetProject,
      hasProjectMemory,
      remember,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node, Session.node],
})
