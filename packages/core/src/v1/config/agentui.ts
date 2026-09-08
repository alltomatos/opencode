export * as ConfigAgentUIV1 from "./agentui"

import { Schema } from "effect"

export const ChannelBinding = Schema.Struct({
  type: Schema.Literals(["telegram"]).annotate({
    description: "Which channel this AgentUI listens/replies on. Only 'telegram' exists today — more (whatsapp, discord, ...) land as new Channel implementations without changing this shape.",
  }),
}).annotate({ identifier: "AgentUIChannelBinding" })
export type ChannelBinding = Schema.Schema.Type<typeof ChannelBinding>

export const RagSource = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["file", "text", "url"]),
  label: Schema.String.annotate({ description: "Display name for this source in the AgentUI form" }),
  value: Schema.String.annotate({
    description: "For 'file': a path under the RAG storage dir. For 'text': the pasted text itself. For 'url': the URL to fetch.",
  }),
}).annotate({ identifier: "AgentUIRagSource" })
export type RagSource = Schema.Schema.Type<typeof RagSource>

export const Guardrails = Schema.Struct({
  enabled: Schema.Boolean,
  level: Schema.Literals(["basic", "strict"]),
}).annotate({ identifier: "AgentUIGuardrails" })
export type Guardrails = Schema.Schema.Type<typeof Guardrails>

export const Agent = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable identifier for this AgentUI" }),
  name: Schema.String.annotate({ description: "Display name" }),
  personality: Schema.String.annotate({ description: "Custom system prompt describing this agent's role/tone" }),
  // Same encoding ModelPickerV2 already uses: "providerID/modelID" for a
  // direct model, "combo:<id>" to resolve through Combo.Service instead —
  // see packages/app/src/components/batuta/model-picker-v2.tsx and
  // packages/opencode/src/combo/index.ts.
  model: Schema.String.annotate({
    description: "'providerID/modelID' for a direct model, or 'combo:<id>' to resolve through a saved combo",
  }),
  channels: Schema.mutable(Schema.Array(ChannelBinding)).annotate({
    description: "Channels this agent is reachable on",
  }),
  commandTriggers: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Prefixes (e.g. '#', '!') that address this agent on a shared channel — the opencode '/' command prefix stays reserved for the built-in command flow",
  }),
  ragSources: Schema.mutable(Schema.Array(RagSource)).annotate({
    description: "Knowledge sources this agent can retrieve from",
  }),
  guardrails: Guardrails,
}).annotate({ identifier: "AgentUIAgent" })
export type Agent = Schema.Schema.Type<typeof Agent>

export const Info = Schema.Record(Schema.String, Agent).annotate({ identifier: "AgentUIConfig" })
export type Info = Schema.Schema.Type<typeof Info>
