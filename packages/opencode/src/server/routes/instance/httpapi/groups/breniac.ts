import { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { UpstreamError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/breniac/config"

export const TranscribeRequest = Schema.Struct({
  /** Base64-encoded audio bytes for a single turn. */
  audio: Schema.String,
  /** e.g. "audio/webm" — passed through as the uploaded file's content type. */
  mimeType: Schema.String,
}).annotate({ identifier: "BreniacTranscribeRequest" })
export type TranscribeRequest = Schema.Schema.Type<typeof TranscribeRequest>

export const TranscribeResponse = Schema.Struct({
  text: Schema.String,
}).annotate({ identifier: "BreniacTranscribeResponse" })
export type TranscribeResponse = Schema.Schema.Type<typeof TranscribeResponse>

export const BreniacApi = HttpApi.make("breniac")
  .add(
    HttpApiGroup.make("breniac")
      .add(
        HttpApiEndpoint.get("getConfig", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigBreniacV1.Info, "Get Breniac config"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.getConfig",
            summary: "Get Breniac configuration",
            description: "Retrieve the Breniac voice assistant's provider and model configuration.",
          }),
        ),
        HttpApiEndpoint.put("setConfig", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigBreniacV1.Info,
          success: described(ConfigBreniacV1.Info, "Config updated successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.setConfig",
            summary: "Set Breniac configuration",
            description: "Replace the Breniac voice assistant's provider and model configuration.",
          }),
        ),
        HttpApiEndpoint.post("transcribe", "/breniac/transcribe", {
          query: WorkspaceRoutingQuery,
          payload: TranscribeRequest,
          success: described(TranscribeResponse, "Transcribed text"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.transcribe",
            summary: "Transcribe a voice turn",
            description: "Send a turn's audio to the configured transcription model and return the text.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "breniac",
          description: "Experimental HttpApi Breniac voice assistant routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
