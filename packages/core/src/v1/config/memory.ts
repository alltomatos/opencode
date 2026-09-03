export * as ConfigMemoryV1 from "./memory"

import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the memory feature is active (off by default, opt-in)",
  }),
  memoryModel: Schema.optional(Schema.String).annotate({
    description: "Model used to summarize a session into the memory files, in 'providerID/modelID' form",
  }),
}).annotate({ identifier: "MemoryConfig" })
export type Info = Schema.Schema.Type<typeof Info>
