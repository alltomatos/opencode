export * as Environment from "./environment"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Environment.ID"),
  statics((schema) => ({ create: () => schema.make("env_" + ascending()) })),
)
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  url: Schema.String,
  token: optional(Schema.String),
  lastPairedAt: optional(Schema.Number),
  ssh: optional(
    Schema.Struct({
      host: Schema.String,
      user: Schema.String,
      port: optional(Schema.Number),
      keyPath: optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "Environment.Info" })
