import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "../memory"

export const Parameters = Schema.Struct({
  note: Schema.String.annotate({
    description:
      "What to remember — a decision, fact, user preference, architectural rule, or correction worth carrying into future sessions. Keep it concise and self-contained.",
  }),
  scope: Schema.optional(Schema.Literals(["project", "global"])).annotate({
    description:
      "Where to save this memory:\n" +
      "- 'project' (default): Specific to the current project/codebase (e.g. tech stack decisions, architectural patterns, local config, project-specific quirks).\n" +
      "- 'global': Broad knowledge, user preferences, personal habits, cross-project instructions, or general rules that apply across all workspaces and repositories.",
  }),
})

export const MemorySaveTool = Tool.define(
  "memory_save",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Save a note to memory (project-scoped or global). Use 'project' scope for project-specific decisions, conventions, and context. Use 'global' scope for user preferences, personal rules, or instructions that should persist across all projects.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const scope = params.scope ?? "project"
          if (scope === "global") {
            const res = yield* memory.promoteGlobal({ summary: params.note })
            return {
              title: "Memória global salva",
              output: `Anotado na memória global: ${params.note}`,
              metadata: {},
            }
          }

          const res = yield* memory.remember({ directory: instance.directory, note: params.note })
          return {
            title: "Memória do projeto salva",
            output: `Anotado na memória do projeto: ${params.note}`,
            metadata: {},
          }
        }),
    }
  }),
)
