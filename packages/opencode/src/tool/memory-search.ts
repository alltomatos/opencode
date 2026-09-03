import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "../memory"

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description:
      "What you're trying to recall (optional, not currently used to filter — the tool returns the most recent memory entries regardless, but stating your query still helps you reason about what you find).",
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
        "Search past memory — decisions, facts, and corrections recorded globally and for this project in " +
        "previous sessions. Call this when the user references something from before, or you're unsure about a " +
        "past decision, preference, or correction that might already be recorded.",
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const { context } = yield* memory.load({ directory: instance.directory })
          if (!context.trim()) {
            return {
              title: "Memória vazia",
              output: "Nenhuma memória registrada ainda (nem global, nem deste projeto).",
              metadata: {},
            }
          }
          return { title: "Memória carregada", output: context, metadata: {} }
        }),
    }
  }),
)
