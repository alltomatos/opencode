import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "../memory"

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description:
      "What you're trying to recall (optional search keyword/phrase or topic to filter relevant memory entries).",
  }),
  scope: Schema.optional(Schema.Literals(["all", "project", "global"])).annotate({
    description:
      "The scope of memory to search:\n" +
      "- 'all' (default): Returns memories from both global (cross-project) and the current project.\n" +
      "- 'project': Returns memories specific to the current project.\n" +
      "- 'global': Returns general/cross-project memories and user preferences.",
  }),
})

// Deliberately NOT auto-injected into every prompt — the model calls this
// when it decides past context might help (the user references something
// prior, or it's unsure about an earlier decision/preference), instead of
// every session paying the token cost of the full memory dump up front.
export const MemorySearchTool = Tool.define(
  "memory_search",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Search past memory — retrieve decisions, facts, conventions, and user preferences. Can search across all memories, only the current project's memory, or global cross-project memory.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const scope = params.scope ?? "all"

          let resultText = ""
          if (scope === "project") {
            const { content } = yield* memory.loadProject(instance.directory)
            resultText = content ? `### Memória do Projeto\n\n${content}` : ""
          } else if (scope === "global") {
            const { content } = yield* memory.loadGlobal()
            resultText = content ? `### Memória Global\n\n${content}` : ""
          } else {
            const globalRes = yield* memory.loadGlobal()
            const projectRes = yield* memory.loadProject(instance.directory)
            const parts: string[] = []
            if (globalRes.content.trim()) {
              parts.push(`### Memória Global (todas as sessões/projetos)\n\n${globalRes.content.trim()}`)
            }
            if (projectRes.content.trim()) {
              parts.push(`### Memória do Projeto (${instance.directory})\n\n${projectRes.content.trim()}`)
            }
            resultText = parts.join("\n\n---\n\n")
          }

          if (!resultText.trim()) {
            return {
              title: "Memória vazia",
              output: `Nenhuma memória registrada para o escopo selecionado (${scope}).`,
              metadata: {},
            }
          }

          // Se forneceu query de busca, aplica um filtro básico ou destaca trechos relevantes se aplicável
          if (params.query && params.query.trim()) {
            const q = params.query.trim().toLowerCase()
            const blocks = resultText.split(/\n(?=## )/)
            const matched = blocks.filter((b) => b.toLowerCase().includes(q))
            if (matched.length > 0) {
              resultText = `Filtro por "${params.query}":\n\n` + matched.join("\n\n")
            }
          }

          return {
            title: "Memória consultada",
            output: resultText,
            metadata: {},
          }
        }),
    }
  }),
)
