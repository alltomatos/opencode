import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { AgentUINotFoundError } from "@/agentui"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/agentui"

export const ListResponse = Schema.Array(ConfigAgentUIV1.Agent)
export const RemoveResponse = Schema.Struct({ success: Schema.Literal(true) })

export const AgentUIApi = HttpApi.make("agentui")
  .add(
    HttpApiGroup.make("agentui")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(ListResponse, "List configured AgentUI agents"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.list",
            summary: "List AgentUI agents",
            description: "List all configured custom conversational agents.",
          }),
        ),
        HttpApiEndpoint.get("get", `${root}/:id`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ConfigAgentUIV1.Agent, "The requested agent"),
          error: AgentUINotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.get",
            summary: "Get an AgentUI agent",
            description: "Read a single custom agent by id.",
          }),
        ),
        HttpApiEndpoint.post("add", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigAgentUIV1.Agent,
          success: described(ConfigAgentUIV1.Agent, "Agent added successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.add",
            summary: "Add or update an AgentUI agent",
            description: "Create or replace a custom conversational agent.",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:id`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(RemoveResponse, "Agent removed successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.remove",
            summary: "Remove an AgentUI agent",
            description: "Delete a custom conversational agent.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "agentui",
          description: "Experimental HttpApi custom-agent (AgentUI) routes.",
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
