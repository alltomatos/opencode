export * as ConfigMemoryV1 from "./memory"

import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the memory feature is active (off by default, opt-in)",
  }),
  memoryModel: Schema.optional(Schema.String).annotate({
    description: "Model used to summarize a session into the memory files, in 'providerID/modelID' form",
  }),
  autoSync: Schema.optional(Schema.Boolean).annotate({
    description: "Whether automatic periodic memory sync routine is enabled (defaults to true)",
  }),
  syncIntervalHours: Schema.optional(Schema.Number).annotate({
    description: "Interval in hours between automatic memory syncs (default: 6)",
  }),
  maxSessionAgeDays: Schema.optional(Schema.Number).annotate({
    description: "Retention period in days for active sessions. Sessions older than this are synthesized into memory and purged (default: 30)",
  }),
}).annotate({ identifier: "MemoryConfig" })
export type Info = Schema.Schema.Type<typeof Info>
