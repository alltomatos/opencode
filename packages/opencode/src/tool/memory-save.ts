import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "../memory"

export const Parameters = Schema.Struct({
  note: Schema.String.annotate({
    description:
      "What to remember — a decision, fact, preference, or correction worth carrying into future sessions " +
      "on this project. Keep it concise and self-contained (it'll be read out of context later).",
  }),
})

// Project-scoped only. Promoting something to *global* memory (relevant
// beyond this one project) still goes through the explicit-confirmation
// summarize()/promoteGlobal() flow — this tool never writes there, so a
// model can't silently pollute global memory just by deciding something
// seems important.
export const MemorySaveTool = Tool.define(
  "memory_save",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Save a note to this project's memory — use when you and the user reach a decision, learn a fact, or " +
        "the user corrects something worth remembering next time this project comes up.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* memory.remember({ directory: instance.directory, note: params.note })
          return { title: "Memória salva", output: `Anotado: ${params.note}`, metadata: {} }
        }),
    }
  }),
)
