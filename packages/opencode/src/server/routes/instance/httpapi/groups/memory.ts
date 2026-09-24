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

export const ProjectEntriesQuery = Schema.Struct({
  directory: Schema.String,
})

export const ProjectMemoryStatus = Schema.Struct({
  hasMemory: Schema.Boolean,
})

export const MemoryContent = Schema.Struct({
  content: Schema.String,
})

export const AddMemoryPayload = Schema.Struct({
  directory: Schema.optional(Schema.String),
  note: Schema.String,
  global: Schema.optional(Schema.Boolean),
})

export const PromoteMemoryPayload = Schema.Struct({
  summary: Schema.String,
})

export const BackfillMemoryPayload = Schema.Struct({
  directory: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})

export const BackfillMemoryResult = Schema.Struct({
  totalSessions: Schema.Number,
  processedSessions: Schema.Number,
  summarizedSessions: Schema.Number,
  projectsCount: Schema.Number,
  errors: Schema.Array(Schema.String),
})

export const MemoryFileResult = Schema.Struct({
  path: Schema.String,
})

export const MemoryPaths = {
  config: "/memory",
  forgetProject: "/memory/project",
  projectEntries: "/memory/project/entries",
  globalEntries: "/memory/global",
  addEntry: "/memory/entry",
  promote: "/memory/promote",
  backfill: "/memory/backfill",
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
        HttpApiEndpoint.get("projectMemoryStatus", MemoryPaths.forgetProject, {
          query: ForgetProjectQuery,
          success: described(ProjectMemoryStatus, "Whether the given project directory has any recorded memory"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.projectMemoryStatus",
            summary: "Check whether a project has any recorded memory",
            description:
              "Used before asking the user whether to forget a project's memory when closing it — no memory means no prompt.",
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
        HttpApiEndpoint.get("getProjectEntries", MemoryPaths.projectEntries, {
          query: ProjectEntriesQuery,
          success: described(MemoryContent, "Project memory entries"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.getProjectEntries",
            summary: "Get project memory content",
            description: "Returns markdown content of recorded memories for the given project directory.",
          }),
        ),
        HttpApiEndpoint.get("getGlobalEntries", MemoryPaths.globalEntries, {
          query: WorkspaceRoutingQuery,
          success: described(MemoryContent, "Global memory entries"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.getGlobalEntries",
            summary: "Get global memory content",
            description: "Returns markdown content of recorded global memories across all projects.",
          }),
        ),
        HttpApiEndpoint.post("addEntry", MemoryPaths.addEntry, {
          query: WorkspaceRoutingQuery,
          payload: AddMemoryPayload,
          success: described(MemoryFileResult, "Path of written memory file"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.addEntry",
            summary: "Add a memory note",
            description: "Directly records a note in project memory or global memory without requiring LLM execution.",
          }),
        ),
        HttpApiEndpoint.post("promote", MemoryPaths.promote, {
          query: WorkspaceRoutingQuery,
          payload: PromoteMemoryPayload,
          success: described(MemoryFileResult, "Path of written global memory file"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.promote",
            summary: "Promote memory to global",
            description: "Promotes a summary/decision to global memory and regenerates the global memory skill file.",
          }),
        ),
        HttpApiEndpoint.post("backfill", MemoryPaths.backfill, {
          query: WorkspaceRoutingQuery,
          payload: BackfillMemoryPayload,
          success: described(BackfillMemoryResult, "Memory backfill execution result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "memory.backfill",
            summary: "Backfill memory from past sessions",
            description: "Scans past sessions and synthesizes missing memory files using the active fallback model.",
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
