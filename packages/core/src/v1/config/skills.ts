export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  claude: Schema.optional(Schema.Boolean).annotate({
    description: "Discover skills from ~/.claude/skills (default: true)",
  }),
  codex: Schema.optional(Schema.Boolean).annotate({
    description: "Discover skills from ~/.codex/skills (default: false)",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
