export * as ConfigCombo from "./combo"

import { Schema } from "effect"

export const ComboModel = Schema.Struct({
  model: Schema.String.annotate({ description: "Model for this combo entry, in 'providerID/modelID' form" }),
  priority: Schema.Number.annotate({
    description: "Lower runs first. Ties broken by array order. Used by the 'priority' failover strategy.",
  }),
}).annotate({ identifier: "ConfigV2.ComboModel" })
export type ComboModel = Schema.Schema.Type<typeof ComboModel>

export const Failover = Schema.Struct({
  enabled: Schema.Boolean.annotate({
    description: "When true, a request that fails on one model retries the next one in the combo instead of failing.",
  }),
  strategy: Schema.Literals(["priority", "round-robin"]).annotate({
    description:
      "'priority' always starts from the lowest-priority model and falls through in order. 'round-robin' starts from whichever model comes after the last one used.",
  }),
}).annotate({ identifier: "ConfigV2.ComboFailover" })
export type Failover = Schema.Schema.Type<typeof Failover>

export const RateLimit = Schema.Struct({
  requestsPerMinute: Schema.optional(Schema.Number).annotate({
    description: "Max requests per minute across the whole combo, regardless of which model handles each one",
  }),
  tokensPerMinute: Schema.optional(Schema.Number).annotate({
    description: "Max total tokens (input+output) per minute across the whole combo",
  }),
}).annotate({ identifier: "ConfigV2.ComboRateLimit" })
export type RateLimit = Schema.Schema.Type<typeof RateLimit>

export class Info extends Schema.Class<Info>("ConfigV2.Combo")({
  id: Schema.String.annotate({ description: "Stable identifier for this combo" }),
  name: Schema.String.annotate({ description: "Display name for this combo" }),
  models: Schema.mutable(Schema.Array(ComboModel)).annotate({
    description: "Models this combo can resolve to, in failover order",
  }),
  failover: Failover,
  rateLimit: Schema.optional(RateLimit),
}) {}
