import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const SystemGroup = HttpApiGroup.make("server.system").add(
  HttpApiEndpoint.post("system.update", "/api/system/update", {
    payload: Schema.Struct({
      confirm: Schema.Boolean,
    }),
    success: Schema.Struct({
      status: Schema.String,
      message: Schema.String,
      currentVersion: Schema.optional(Schema.String),
    }),
    error: [HttpApiError.BadRequest],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.system.update",
      summary: "Update remote server daemon",
      description: "Trigger update of opencode CLI and restart background daemon.",
    }),
  ),
)
