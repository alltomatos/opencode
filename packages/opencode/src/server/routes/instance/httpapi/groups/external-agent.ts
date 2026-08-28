import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { Authorization, PtyConnectAuthorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { ExternalAgentForbiddenError, ExternalAgentSessionNotFoundError } from "../errors"
import { described } from "./metadata"

const root = "/external-agent"

export const DetectedAgent = Schema.Struct({
  id: Schema.String,
  installed: Schema.Boolean,
})
export const DetectResponse = Schema.Array(DetectedAgent)

export const SetSkillPayload = Schema.Struct({
  install: Schema.Boolean,
})
export const SetSkillResponse = Schema.Struct({
  installed: Schema.Boolean,
})

export const SessionInfo = Schema.Struct({
  handle: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  pid: Schema.Number,
})

export const ConnectToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: Schema.Number,
})

export const ExternalAgentSessionsPaths = {
  list: `${root}/sessions`,
  connectToken: `${root}/sessions/:handle/connect-token`,
  connect: `${root}/sessions/:handle/connect`,
} as const

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
        HttpApiEndpoint.post("setSkill", `${root}/:id/skill`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SetSkillPayload,
          success: described(SetSkillResponse, "Skill installation updated"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "externalAgent.setSkill",
            summary: "Install or remove the batuta-cli skill for an agent",
            description:
              "Writes or removes ~/<agent skills dir>/batuta-cli/SKILL.md on the connected server for the given known agent id.",
          }),
        ),
        HttpApiEndpoint.get("listSessions", ExternalAgentSessionsPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SessionInfo), "Active external agent PTY sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "externalAgent.listSessions",
            summary: "List active external agent PTY sessions",
            description: "Get a list of currently running external agent worker sessions for this instance.",
          }),
        ),
        HttpApiEndpoint.post("connectToken", ExternalAgentSessionsPaths.connectToken, {
          params: { handle: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ConnectToken, "WebSocket connect token"),
          error: [ExternalAgentForbiddenError, ExternalAgentSessionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "externalAgent.connectToken",
            summary: "Create external agent session WebSocket token",
            description: "Create a short-lived ticket for opening an external agent session WebSocket connection.",
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

export const ExternalAgentConnectApi = HttpApi.make("externalAgent-connect").add(
  HttpApiGroup.make("externalAgent-connect")
    .add(
      // Decode the connect query fields in the raw handler after checking existence,
      // mirroring PtyConnectApi's connect endpoint ordering.
      HttpApiEndpoint.get("connect", ExternalAgentSessionsPaths.connect, {
        params: { handle: Schema.String },
        success: described(Schema.Boolean, "Connected session"),
        error: [HttpApiError.Forbidden, HttpApiError.NotFound],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "externalAgent.connect",
          summary: "Connect to an external agent session",
          description:
            "Establish a WebSocket connection to observe (and, once #108 lands, control) an external agent worker's PTY in real-time.",
          transform: (operation) => ({
            ...operation,
            parameters: [
              ...(operation.parameters ?? []),
              ...["directory", "workspace", "ticket"].map((name) => ({
                in: "query",
                name,
                schema: { type: "string" },
              })),
            ],
          }),
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "externalAgent", description: "External agent websocket route." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(PtyConnectAuthorization),
)
