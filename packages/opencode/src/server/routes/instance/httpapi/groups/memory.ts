import { ConfigMemoryV1 } from "@opencode-ai/core/v1/config/memory"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const ForgetProjectQuery = Schema.Struct({
  directory: Schema.String,
})

export const MemoryPaths = {
  config: "/memory",
  forgetProject: "/memory/project",
} as const

export const MemoryApi = HttpApi.make("memory")
  .add(
    HttpApiGroup.make("memory")
      .add(
        HttpApiEndpoint.get("getConfig", MemoryPaths.config, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigMemoryV1.Info, "Current memory configuration"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.getConfig",
            summary: "Get memory configuration",
            description: "Whether memory is enabled and which model summarizes/answers memory lookups.",
          }),
        ),
        HttpApiEndpoint.put("setConfig", MemoryPaths.config, {
          query: WorkspaceRoutingQuery,
          payload: ConfigMemoryV1.Info,
          success: described(ConfigMemoryV1.Info, "Memory configuration saved"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.setConfig",
            summary: "Update memory configuration",
            description: "Enable/disable memory and choose the model used for it.",
          }),
        ),
        HttpApiEndpoint.delete("forgetProject", MemoryPaths.forgetProject, {
          query: ForgetProjectQuery,
          success: described(Schema.Literal(true), "Project memory deleted"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.forgetProject",
            summary: "Delete a project's memory",
            description: "Deletes all memory entries recorded for the given project directory. Global memory is untouched.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "memory",
          description: "Experimental HttpApi cross-session memory routes.",
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
