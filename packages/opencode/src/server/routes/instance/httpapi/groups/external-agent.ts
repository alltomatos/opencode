import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/external-agent"

export const DetectedAgent = Schema.Struct({
  id: Schema.String,
  installed: Schema.Boolean,
})
export const DetectResponse = Schema.Array(DetectedAgent)

export const ExternalAgentApi = HttpApi.make("externalAgent")
  .add(
    HttpApiGroup.make("externalAgent")
      .add(
        HttpApiEndpoint.get("detect", `${root}/detect`, {
          query: WorkspaceRoutingQuery,
          success: described(DetectResponse, "Known external agent CLIs and whether each is installed"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "externalAgent.detect",
            summary: "Detect installed external agent CLIs",
            description:
              "Scans the connected server's PATH for every agent in the known registry (claude, codex, ...) without spawning any subprocess.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "externalAgent",
          description: "External agent CLI detection routes.",
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
