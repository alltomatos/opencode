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

export const RouteCommand = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "BreniacRouteCommand" })

export const RouteRequest = Schema.Struct({
  text: Schema.String,
  commands: Schema.Array(RouteCommand),
}).annotate({ identifier: "BreniacRouteRequest" })
export type RouteRequest = Schema.Schema.Type<typeof RouteRequest>

export const RouteResponse = Schema.Struct({
  kind: Schema.Literals(["appCommand", "sessionPrompt"]),
  /** Present when kind === "appCommand": the id of the command to trigger. */
  commandID: Schema.optional(Schema.String),
  /** Present when kind === "sessionPrompt": the text to send to the session. */
  prompt: Schema.optional(Schema.String),
}).annotate({ identifier: "BreniacRouteResponse" })
export type RouteResponse = Schema.Schema.Type<typeof RouteResponse>

export const SpeakRequest = Schema.Struct({
  text: Schema.String,
}).annotate({ identifier: "BreniacSpeakRequest" })
export type SpeakRequest = Schema.Schema.Type<typeof SpeakRequest>

export const SpeakResponse = Schema.Struct({
  /** Base64-encoded raw PCM16 samples (no container). */
  audio: Schema.String,
  sampleRate: Schema.Number,
  channels: Schema.Number,
}).annotate({ identifier: "BreniacSpeakResponse" })
export type SpeakResponse = Schema.Schema.Type<typeof SpeakResponse>

export const AppendTurnRequest = Schema.Struct({
  /** Identifies one continuous voice session — stable while Breniac stays on. */
  voiceSessionID: Schema.String,
  transcript: Schema.String,
  response: Schema.String,
}).annotate({ identifier: "BreniacAppendTurnRequest" })
export type AppendTurnRequest = Schema.Schema.Type<typeof AppendTurnRequest>

export const AppendTurnResponse = Schema.Struct({
  path: Schema.String,
}).annotate({ identifier: "BreniacAppendTurnResponse" })
export type AppendTurnResponse = Schema.Schema.Type<typeof AppendTurnResponse>

export const SummarizeRequest = Schema.Struct({
  voiceSessionID: Schema.String,
  /** Project directory of the current session — used to key the project memory file. */
  directory: Schema.String,
}).annotate({ identifier: "BreniacSummarizeRequest" })
export type SummarizeRequest = Schema.Schema.Type<typeof SummarizeRequest>

export const SummarizeResponse = Schema.Struct({
  /** False when the temp file was empty/missing — nothing to summarize. */
  summarized: Schema.Boolean,
  summary: Schema.optional(Schema.String),
  /** True when the model thinks this belongs in global memory too — requires user confirmation before promoting. */
  suggestsGlobal: Schema.optional(Schema.Boolean),
  globalReason: Schema.optional(Schema.String),
}).annotate({ identifier: "BreniacSummarizeResponse" })
export type SummarizeResponse = Schema.Schema.Type<typeof SummarizeResponse>

export const PromoteGlobalRequest = Schema.Struct({
  summary: Schema.String,
}).annotate({ identifier: "BreniacPromoteGlobalRequest" })
export type PromoteGlobalRequest = Schema.Schema.Type<typeof PromoteGlobalRequest>

export const PromoteGlobalResponse = Schema.Struct({
  path: Schema.String,
}).annotate({ identifier: "BreniacPromoteGlobalResponse" })
export type PromoteGlobalResponse = Schema.Schema.Type<typeof PromoteGlobalResponse>

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
        HttpApiEndpoint.post("route", "/breniac/route", {
          query: WorkspaceRoutingQuery,
          payload: RouteRequest,
          success: described(RouteResponse, "Turn routing decision"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.route",
            summary: "Route a transcribed turn",
            description: "Decide whether a transcribed turn is an app command or a session prompt.",
          }),
        ),
        HttpApiEndpoint.post("speak", "/breniac/speak", {
          query: WorkspaceRoutingQuery,
          payload: SpeakRequest,
          success: described(SpeakResponse, "Spoken audio for the response text"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.speak",
            summary: "Speak a response",
            description: "Send response text to the configured audio model and return PCM16 audio.",
          }),
        ),
        HttpApiEndpoint.post("appendTurn", "/breniac/turn", {
          query: WorkspaceRoutingQuery,
          payload: AppendTurnRequest,
          success: described(AppendTurnResponse, "Turn appended to the temp file"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.appendTurn",
            summary: "Append a turn to the voice session temp file",
            description: "Persist a transcript/response pair to disk immediately, so it survives a crash.",
          }),
        ),
        HttpApiEndpoint.post("summarize", "/breniac/summarize", {
          query: WorkspaceRoutingQuery,
          payload: SummarizeRequest,
          success: described(SummarizeResponse, "Voice session summary"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.summarize",
            summary: "Summarize a voice session into project memory",
            description: "Summarize the temp file into the project's memory/YYYY-MM-DD.md, appending to it.",
          }),
        ),
        HttpApiEndpoint.post("promoteGlobal", "/breniac/promote-global", {
          query: WorkspaceRoutingQuery,
          payload: PromoteGlobalRequest,
          success: described(PromoteGlobalResponse, "Global memory entry written"),
          error: UpstreamError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "breniac.promoteGlobal",
            summary: "Promote a summary to global memory",
            description: "Append a summary to global memory — only call after explicit user confirmation.",
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
