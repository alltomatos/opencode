import { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { BatutaActivityNotFoundError, BatutaWorkerNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/batuta"

export const ListResponse = Schema.Array(ConfigBatutaV1.Activity)
export const StartResponse = Schema.Struct({ sessionID: Schema.String })
export const RemoveResponse = Schema.Struct({ success: Schema.Literal(true) })
export const SyncResponse = Schema.Struct({
  activity: ConfigBatutaV1.Activity,
  handoff: Schema.optional(Schema.String),
})
export const BranchesResponse = Schema.Struct({
  current: Schema.optional(Schema.String),
  branches: Schema.Array(Schema.String),
})
export const PipelineDefinitionResponse = Schema.Struct({
  content: Schema.optional(Schema.String),
})
export const PipelineDefinitionPayload = Schema.Struct({
  content: Schema.String,
})
export const DelegatePayload = Schema.Struct({
  label: Schema.String,
  prompt: Schema.String,
})
export const DelegateResponse = Schema.Struct({
  output: Schema.String,
})

export const BatutaApi = HttpApi.make("batuta")
  .add(
    HttpApiGroup.make("batuta")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(ListResponse, "List Batuta activities"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.list",
            summary: "List Batuta activities",
            description: "List all configured Batuta orchestration activities.",
          }),
        ),
        HttpApiEndpoint.post("add", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigBatutaV1.Activity,
          success: described(ConfigBatutaV1.Activity, "Activity added successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.add",
            summary: "Add or update a Batuta activity",
            description: "Create or replace a Batuta orchestration activity (orchestrator + workers).",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:id`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(RemoveResponse, "Activity removed successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.remove",
            summary: "Remove a Batuta activity",
            description: "Delete a Batuta orchestration activity.",
          }),
        ),
        HttpApiEndpoint.post("start", `${root}/:id/start`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(StartResponse, "Activity started"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.start",
            summary: "Start a Batuta activity",
            description:
              "Start a Batuta orchestration activity: creates the dedicated Architect session (and worker worktrees, if enabled) and returns its session ID. The Orchestrator session is created later, once the Architect hands off — see batuta.sync.",
          }),
        ),
        HttpApiEndpoint.post("sync", `${root}/:id/sync`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(SyncResponse, "Current activity state and handoff (if ready)"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.sync",
            summary: "Sync a Batuta activity's phase",
            description:
              "Poll while an activity is in the 'architecting' phase: checks for the Architect's handoff file and, once found, moves the activity to 'ready' and returns the handoff content for review.",
          }),
        ),
        HttpApiEndpoint.get("branches", `${root}/branches`, {
          query: WorkspaceRoutingQuery,
          success: described(BranchesResponse, "Local git branches for the given directory"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.branches",
            summary: "List local git branches",
            description: "List local git branches for a directory, plus the current one — used by the activity form's branch picker.",
          }),
        ),
        HttpApiEndpoint.post("dispatch", `${root}/:id/dispatch`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(StartResponse, "Orchestrator started"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.dispatch",
            summary: "Dispatch a 'ready' Batuta activity to the orchestrator",
            description:
              "Called when the user clicks 'Iniciar atividade' on a 'ready' activity: creates the Orchestrator session from the reviewed handoff and returns its session ID.",
          }),
        ),
        HttpApiEndpoint.get("getPipelineDefinition", `${root}/:id/pipeline-definition`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(PipelineDefinitionResponse, "Current pipeline definition, if it exists"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.getPipelineDefinition",
            summary: "Read the project's pipeline definition",
            description:
              "Reads docs/batuta-pipeline.md for the activity's project — the phases/skills flow the Architect defined (or the user edited), shared across all activities in that project.",
          }),
        ),
        HttpApiEndpoint.put("setPipelineDefinition", `${root}/:id/pipeline-definition`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: PipelineDefinitionPayload,
          success: described(PipelineDefinitionResponse, "Pipeline definition saved"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.setPipelineDefinition",
            summary: "Edit the project's pipeline definition",
            description:
              "Overwrites docs/batuta-pipeline.md — lets the user edit the flow at any point, including while the Orchestrator is already dispatching (it re-reads the file periodically).",
          }),
        ),
        HttpApiEndpoint.post("delegate", `${root}/:id/delegate`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: DelegatePayload,
          success: described(DelegateResponse, "Worker delegation result"),
          error: [BatutaActivityNotFoundError, BatutaWorkerNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.delegate",
            summary: "Delegate a task to a worker (for external-CLI orchestrators)",
            description:
              "Called by an external-CLI orchestrator (no task tool available) to delegate a task to one of its pre-configured workers by label. Synchronous — the response only arrives once the worker finishes.",
          }),
        ),
        HttpApiEndpoint.post("startPipelineChat", `${root}/:id/pipeline-chat`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(StartResponse, "Pipeline chat session started"),
          error: BatutaActivityNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "batuta.startPipelineChat",
            summary: "Start a chat session to edit the pipeline definition",
            description:
              "Creates a session scoped to editing docs/batuta-pipeline.md — hidden from the normal session list (it's a child of the Architect/Orchestrator session) and restricted to only that file.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "batuta",
          description: "Experimental HttpApi Batuta orchestration routes.",
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
