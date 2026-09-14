export { Environment } from "@opencode-ai/schema/environment"

import { Environment } from "@opencode-ai/schema/environment"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const EnvironmentCreateInput = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  token: Schema.optional(Schema.String),
  ssh: Schema.optional(
    Schema.Struct({
      host: Schema.String,
      user: Schema.String,
      port: Schema.optional(Schema.Number),
      keyPath: Schema.optional(Schema.String),
    }),
  ),
})

export const EnvironmentGroup = HttpApiGroup.make("client.environment")
  .add(
    HttpApiEndpoint.get("environment.list", "/api/environment", {
      query: LocationQuery,
      success: Schema.Array(Environment.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.environment.list",
          summary: "List environments",
          description: "List all saved remote environments.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("environment.create", "/api/environment", {
      query: LocationQuery,
      payload: EnvironmentCreateInput,
      success: Environment.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.environment.create",
          summary: "Create environment",
          description: "Save a new remote environment.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("environment.remove", "/api/environment/:environmentID", {
      params: { environmentID: Environment.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.environment.remove",
          summary: "Remove environment",
          description: "Remove a saved remote environment.",
        }),
      ),
  )
