import { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { BatutaActivityNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/batuta"

export const ListResponse = Schema.Array(ConfigBatutaV1.Activity)
export const StartResponse = Schema.Struct({ sessionID: Schema.String })
export const RemoveResponse = Schema.Struct({ success: Schema.Literal(true) })

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
              "Start a Batuta orchestration activity: creates the orchestrator session (and worker worktrees, if enabled) and returns its session ID.",
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
