export * as ConfigExternalAgentV1 from "./external-agent"

import { Schema } from "effect"

export const Info = Schema.Struct({
  selectedAgents: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Known external agent CLI ids (see KNOWN_EXTERNAL_AGENTS) to install the batuta-cli skill on. Absent means every detected agent.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
