export * as ConfigBreniacV1 from "./breniac"

import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the Breniac sidebar entry is shown at all (off by default)",
  }),
  providerID: Schema.optional(Schema.String).annotate({
    description: "Provider used for Breniac's voice conversation (e.g. 'omnrt')",
  }),
  audioModel: Schema.optional(Schema.String).annotate({
    description: "Model used for the live voice conversation, in 'providerID/modelID' form",
  }),
  transcriptionModel: Schema.optional(Schema.String).annotate({
    description: "Model used to transcribe the user's speech (STT), in 'providerID/modelID' form",
  }),
  memoryModel: Schema.optional(Schema.String).annotate({
    description: "Model used to summarize a voice session into the memory files, in 'providerID/modelID' form",
  }),
}).annotate({ identifier: "BreniacConfig" })
export type Info = Schema.Schema.Type<typeof Info>
