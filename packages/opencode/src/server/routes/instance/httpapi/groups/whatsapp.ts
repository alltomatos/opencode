import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { AgentUINotFoundError } from "@/agentui"
import {
  IzapiaGroup,
  IzapiaGroupParticipant,
  IzapiaSession,
  PapiGroup,
  PapiInstance,
  WhatsAppChannelNotConfiguredError,
  WhatsAppInvalidWebhookError,
  WhatsAppProviderApiError,
} from "@/whatsapp"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/whatsapp"

export const WebhookResponse = Schema.Struct({ ok: Schema.Literal(true) })
export const IzapiaSessionsPayload = Schema.Struct({ apiKey: Schema.String })
export const IzapiaGroupsPayload = Schema.Struct({ apiKey: Schema.String, sids: Schema.Array(Schema.String) })
export const IzapiaGroupParticipantsPayload = Schema.Struct({
  apiKey: Schema.String,
  sid: Schema.String,
  groupId: Schema.String,
})
export const PapiInstancesPayload = Schema.Struct({ token: Schema.String })
export const PapiCreateInstancePayload = Schema.Struct({ token: Schema.String, instanceName: Schema.String })
export const PapiSetupWebhookPayload = Schema.Struct({
  token: Schema.String,
  instanceId: Schema.String,
  webhookUrl: Schema.String,
})
export const PapiGroupsPayload = Schema.Struct({ token: Schema.String, instanceIds: Schema.Array(Schema.String) })

export const WhatsAppApi = HttpApi.make("whatsapp")
  .add(
    HttpApiGroup.make("whatsapp")
      .add(
        // Called by the WhatsApp gateway (WAHA/Evolution/Z-API/...), never by
        // our own client — deliberately NOT gated by the Authorization
        // middleware every other instance route uses, since an external
        // provider can't present our session credentials. Protected instead
        // by the per-channel `secret` path segment (see
        // ConfigAgentUIV1.WhatsAppChannelBinding.webhookSecret): unguessable,
        // generated once per channel, embedded in the URL handed to the
        // provider. `directory` (which instance/project this agent belongs
        // to) travels the same way, as a query param on that same URL —
        // WorkspaceRoutingMiddleware still needs it to route the request,
        // same as every other instance-scoped endpoint.
        HttpApiEndpoint.post("webhook", `${root}/webhook/:agentId/:secret`, {
          params: { agentId: Schema.String, secret: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: Schema.Unknown,
          success: described(WebhookResponse, "Webhook processed"),
          error: [AgentUINotFoundError, WhatsAppChannelNotConfiguredError, WhatsAppInvalidWebhookError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.webhook",
            summary: "Receive a WhatsApp webhook for an AgentUI agent",
            description:
              "Inbound webhook endpoint for the agent's configured WhatsApp channel (via waconector). Never call this directly — it's the URL configured on the WhatsApp gateway itself.",
          }),
        ),
        // Called by our own client (the agent form's "buscar sessões"
        // button) — deliberately not gated by the Authorization middleware
        // either, but for a different reason than the webhook route above:
        // it carries no server-side secret at all, just proxies the caller-
        // supplied `apiKey` straight to izapia's own API. Worst case, a
        // caller who already holds some izapia API key uses this endpoint
        // to list that key's own sessions — nothing an authenticated opencode
        // session wouldn't already let them do directly against izapia.
        HttpApiEndpoint.post("izapiaSessions", `${root}/izapia/sessions`, {
          payload: IzapiaSessionsPayload,
          success: described(Schema.Array(IzapiaSession), "Sessions for this izapia tenant"),
          error: WhatsAppProviderApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.izapiaSessions",
            summary: "List izapia sessions",
            description: "Lists the WhatsApp sessions already created for the tenant that owns the given izapia API key.",
          }),
        ),
        // Same reasoning as izapiaSessions above — no server-side secret,
        // just proxies the caller-supplied credentials.
        HttpApiEndpoint.post("izapiaGroups", `${root}/izapia/groups`, {
          payload: IzapiaGroupsPayload,
          success: described(Schema.Array(IzapiaGroup), "Groups across the given izapia sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.izapiaGroups",
            summary: "List izapia groups",
            description: "Lists WhatsApp groups across the given izapia sessions, deduped by group id.",
          }),
        ),
        HttpApiEndpoint.post("izapiaGroupParticipants", `${root}/izapia/group-participants`, {
          payload: IzapiaGroupParticipantsPayload,
          success: described(Schema.Array(IzapiaGroupParticipant), "Participants in an izapia group"),
          error: WhatsAppProviderApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.izapiaGroupParticipants",
            summary: "List izapia group participants",
            description: "Lists participants of a specific izapia WhatsApp group with resolved profile names.",
          }),
        ),
        HttpApiEndpoint.post("papiInstances", `${root}/papi/instances`, {
          payload: PapiInstancesPayload,
          success: described(Schema.Array(PapiInstance), "Instances for this Papi Cloud profile"),
          error: WhatsAppProviderApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.papiInstances",
            summary: "List Papi Cloud instances",
            description: "Lists WhatsApp instances for the account that owns the given Papi profile token.",
          }),
        ),
        HttpApiEndpoint.post("papiCreateInstance", `${root}/papi/create-instance`, {
          payload: PapiCreateInstancePayload,
          success: described(PapiInstance, "Created Papi Cloud instance"),
          error: WhatsAppProviderApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.papiCreateInstance",
            summary: "Create Papi Cloud instance",
            description: "Creates a new WhatsApp instance on Papi Cloud using the profile token.",
          }),
        ),
        HttpApiEndpoint.post("papiSetupWebhook", `${root}/papi/setup-webhook`, {
          payload: PapiSetupWebhookPayload,
          success: described(Schema.Struct({ ok: Schema.Literal(true), url: Schema.String }), "Papi webhook configured"),
          error: WhatsAppProviderApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.papiSetupWebhook",
            summary: "Configure Papi Cloud webhook",
            description: "Configures real-time inbound webhook on Papi Cloud instance pointing to this agent.",
          }),
        ),
        HttpApiEndpoint.post("papiGroups", `${root}/papi/groups`, {
          payload: PapiGroupsPayload,
          success: described(Schema.Array(PapiGroup), "Groups across the given Papi instances"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "whatsapp.papiGroups",
            summary: "List Papi Cloud groups",
            description: "Lists WhatsApp groups across the given Papi instances, deduped by group id.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "whatsapp",
          description: "Experimental HttpApi WhatsApp channel webhook route.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
