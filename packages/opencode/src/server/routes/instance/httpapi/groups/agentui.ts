import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { AgentUINotFoundError, AgentUIGenerateFailedError } from "@/agentui"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/agentui"

export const ListResponse = Schema.Array(ConfigAgentUIV1.Agent)
export const RemoveResponse = Schema.Struct({ success: Schema.Literal(true) })
// `projectDirectory`, not `directory` — WorkspaceRoutingQuery already has its
// own `directory` query param (which instance handles the request); this one
// picks which connected project's models/skills the sandbox session runs
// against, and naming it the same would collide in the generated SDK
// (query_directory vs body_directory).
export const TestPayload = Schema.Struct({ projectDirectory: Schema.String, message: Schema.String })
export const TestResponse = Schema.Struct({ reply: Schema.String, blocked: Schema.Boolean })
export const GenerateDraftPayload = Schema.Struct({ description: Schema.String })
export const GenerateDraftResponse = Schema.Struct({
  name: Schema.String,
  personality: Schema.String,
  commandTriggers: Schema.Array(Schema.String),
  guardrails: ConfigAgentUIV1.Guardrails,
})

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
        HttpApiEndpoint.post("generate", `${root}/generate`, {
          query: WorkspaceRoutingQuery,
          payload: GenerateDraftPayload,
          success: described(GenerateDraftResponse, "Generated agent draft"),
          error: AgentUIGenerateFailedError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.generate",
            summary: "Generate an AgentUI draft from a natural-language description",
            description:
              "One-shot generation: drafts name, personality/system-prompt, command trigger and guardrail level from a free-text description, for the user to review before saving.",
          }),
        ),
        HttpApiEndpoint.post("test", `${root}/:id/test`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: TestPayload,
          success: described(TestResponse, "Sandbox reply from the agent"),
          error: AgentUINotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.test",
            summary: "Send a sandbox test message to an AgentUI agent",
            description:
              "Runs a message through the agent's real pipeline (guardrails, personality, RAG, model) against a dedicated sandbox session, without touching any real channel.",
          }),
        ),
        HttpApiEndpoint.post("resetSandbox", `${root}/:id/sandbox/reset`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(RemoveResponse, "Sandbox conversation reset"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agentui.resetSandbox",
            summary: "Reset an AgentUI agent's sandbox conversation",
            description: "Starts a fresh sandbox session for this agent on the next test message.",
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
