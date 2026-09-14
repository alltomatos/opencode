export * as Credential from "./credential"

import { Schema } from "effect"
import { optional } from "./schema"
import { IntegrationID, IntegrationMethodID } from "./integration-id"
import { ascending } from "./identifier"
import { NonNegativeInt, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  statics((schema) => ({ create: () => schema.make("cred_" + ascending()) })),
)
export type ID = typeof ID.Type

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  methodID: IntegrationMethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.OAuth" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.Key" })

export const Value = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" })
export type Value = Schema.Schema.Type<typeof Value>

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: IntegrationID,
  label: Schema.String,
  value: Value,
}).annotate({ identifier: "Credential.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  integrationID: IntegrationID,
  label: optional(Schema.String),
  value: Value,
}).annotate({ identifier: "Credential.CreateInput" })
