export * as Schedule from "./schedule"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Schedule.ID"),
  statics((schema) => ({ create: () => schema.make("sch_" + ascending()) })),
)
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  cron: Schema.String,
  command: Schema.String,
  workspace: optional(Schema.String),
  enabled: optional(Schema.Boolean),
  lastRunAt: optional(Schema.Number),
  lastStatus: optional(Schema.Literals(["success", "error"])),
  lastError: optional(Schema.String),
}).annotate({ identifier: "Schedule.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  cron: Schema.String,
  command: Schema.String,
  workspace: optional(Schema.String),
  enabled: optional(Schema.Boolean),
}).annotate({ identifier: "Schedule.CreateInput" })
