import { ConfigComboV1 } from "@opencode-ai/core/v1/config/combo"
import { ComboExhaustedError, ComboNotFoundError } from "@/combo"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/combo"

export const ListResponse = Schema.Array(ConfigComboV1.Combo)
export const RemoveResponse = Schema.Struct({ success: Schema.Literal(true) })
export const ResolveResponse = Schema.Struct({ providerID: Schema.String, modelID: Schema.String })

export const ComboApi = HttpApi.make("combo")
  .add(
    HttpApiGroup.make("combo")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(ListResponse, "List configured combos"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "combo.list",
            summary: "List combos",
            description: "List all configured model combos.",
          }),
        ),
        HttpApiEndpoint.post("add", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigComboV1.Combo,
          success: described(ConfigComboV1.Combo, "Combo added successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "combo.add",
            summary: "Add or update a combo",
            description: "Create or replace a model combo (models, failover, rate limit).",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:id`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(RemoveResponse, "Combo removed successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "combo.remove",
            summary: "Remove a combo",
            description: "Delete a model combo.",
          }),
        ),
        HttpApiEndpoint.get("resolve", `${root}/:id/resolve`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ResolveResponse, "The model this combo currently resolves to"),
          error: [ComboNotFoundError, ComboExhaustedError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "combo.resolve",
            summary: "Resolve a combo to a concrete model",
            description:
              "Applies the combo's failover/rate-limit rules and returns which provider/model to use right now — mainly useful for debugging a combo's behavior from the UI.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "combo",
          description: "Experimental HttpApi model-combo routes.",
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
