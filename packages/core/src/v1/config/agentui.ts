export * as ConfigAgentUIV1 from "./agentui"

import { Schema } from "effect"

export const TelegramChannelBinding = Schema.Struct({
  type: Schema.Literal("telegram"),
  // Per-agent bot token (from @BotFather) — when set, this agent gets its
  // own dedicated Telegram bot/poll loop that responds to every message
  // directly, no command-trigger prefix needed. When absent, the agent
  // stays reachable only through the shared server-wide bot configured in
  // Settings → Integrations, addressed by its commandTriggers prefix (the
  // original, still-supported multiplexed mode from before per-agent
  // tokens existed).
  token: Schema.optional(Schema.String).annotate({
    description: "Dedicated Telegram bot token for this agent (from @BotFather). Leave unset to share the server's global bot instead.",
  }),
  // Which connected project's models/skills/RAG this agent's dedicated bot
  // runs sessions against — same role `directory` plays for the sandbox
  // test chat (see AgentUI.Service.testMessage). Only meaningful when
  // `token` is set.
  directory: Schema.optional(Schema.String).annotate({
    description: "Connected project directory this agent's dedicated bot operates against. Required alongside token.",
  }),
}).annotate({ identifier: "AgentUITelegramChannelBinding" })
export type TelegramChannelBinding = Schema.Schema.Type<typeof TelegramChannelBinding>

// The waconector package (https://alltomatos.github.io/waconector/) wraps 9
// unofficial WhatsApp APIs behind one contract — some self-hosted (need a
// Docker container the user runs themselves), some SaaS (need only an API
// key). Every provider's real required fields differ (see
// packages/opencode/src/whatsapp/index.ts PROVIDER_FIELDS, sourced directly
// from each adapter's shipped .d.ts, not the docs site — which uses
// different factory names than the actual package). `config` is therefore
// untyped here on purpose: validating it against the right shape for the
// selected `provider` is WhatsApp.Service's job, at connect time.
export const WHATSAPP_PROVIDERS = [
  "waha",
  "evolution",
  "zapi",
  "uazapi",
  "whapi",
  "wuzapi",
  "quepasa",
  "wppconnect",
  "izapia",
] as const
export type WhatsAppProvider = (typeof WHATSAPP_PROVIDERS)[number]

export const WhatsAppChannelBinding = Schema.Struct({
  type: Schema.Literal("whatsapp"),
  provider: Schema.Literals(WHATSAPP_PROVIDERS).annotate({
    description: "Which unofficial WhatsApp API this channel connects through (see waconector).",
  }),
  config: Schema.Record(Schema.String, Schema.String).annotate({
    description: "Provider-specific connection fields (e.g. baseUrl+apiKey for WAHA, instanceId+token for Z-API). Shape depends on `provider`.",
  }),
  // izapia is multi-session per tenant (one API key, several WhatsApp
  // numbers) — this agent can listen on more than one at once. Absent for
  // single-session providers, which keep using `config.sid`/`config.session`
  // instead. When present, it's the source of truth for which sessions this
  // channel is bound to; `config.sid` (if still set from before this field
  // existed) is ignored.
  sessionIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Session IDs this channel listens on, for providers with multiple sessions per tenant (izapia). Absent means single-session (see config.sid).",
  }),
  // Direct messages are always answered; a group is only answered if its
  // JID is listed here. Empty/absent = groups off entirely (DMs only) —
  // the safer default, since a bot answering in every group it's ever
  // added to is rarely what someone wants.
  allowedGroups: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "WhatsApp group JIDs this agent may respond in, in addition to direct messages. Empty/absent means direct messages only.",
  }),
  directory: Schema.optional(Schema.String).annotate({
    description: "Connected project directory this agent's WhatsApp channel operates against.",
  }),
  // Generated once, embedded in the webhook URL handed to the provider —
  // this inbound endpoint is called by a third-party service (not our own
  // authenticated client), so it can't go through the normal Authorization
  // middleware; this secret is the only thing standing between it and the
  // public internet. See WhatsApp.Service.handleWebhook.
  webhookSecret: Schema.String.annotate({
    description: "Random per-channel secret embedded in the webhook URL — authenticates inbound webhook calls from the provider.",
  }),
}).annotate({ identifier: "AgentUIWhatsAppChannelBinding" })
export type WhatsAppChannelBinding = Schema.Schema.Type<typeof WhatsAppChannelBinding>

export const ChannelBinding = Schema.Union([TelegramChannelBinding, WhatsAppChannelBinding]).annotate({
  identifier: "AgentUIChannelBinding",
})
export type ChannelBinding = Schema.Schema.Type<typeof ChannelBinding>

export const RagSource = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["file", "text", "url"]),
  label: Schema.String.annotate({ description: "Display name for this source in the AgentUI form" }),
  value: Schema.String.annotate({
    description: "For 'file': a path under the RAG storage dir. For 'text': the pasted text itself. For 'url': the URL to fetch.",
  }),
}).annotate({ identifier: "AgentUIRagSource" })
export type RagSource = Schema.Schema.Type<typeof RagSource>

export const Guardrails = Schema.Struct({
  enabled: Schema.Boolean,
  level: Schema.Literals(["basic", "strict"]),
}).annotate({ identifier: "AgentUIGuardrails" })
export type Guardrails = Schema.Schema.Type<typeof Guardrails>

export const Agent = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable identifier for this AgentUI" }),
  name: Schema.String.annotate({ description: "Display name" }),
  personality: Schema.String.annotate({ description: "Custom system prompt describing this agent's role/tone" }),
  // Same encoding ModelPickerV2 already uses: "providerID/modelID" for a
  // direct model, "combo:<id>" to resolve through Combo.Service instead —
  // see packages/app/src/components/batuta/model-picker-v2.tsx and
  // packages/opencode/src/combo/index.ts.
  model: Schema.String.annotate({
    description: "'providerID/modelID' for a direct model, or 'combo:<id>' to resolve through a saved combo",
  }),
  channels: Schema.mutable(Schema.Array(ChannelBinding)).annotate({
    description: "Channels this agent is reachable on",
  }),
  commandTriggers: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Prefixes (e.g. '#', '!') that address this agent on a shared channel — the opencode '/' command prefix stays reserved for the built-in command flow",
  }),
  ragSources: Schema.mutable(Schema.Array(RagSource)).annotate({
    description: "Knowledge sources this agent can retrieve from",
  }),
  guardrails: Guardrails,
  // Names of MCP servers (as configured for `channels[].directory`/the
  // sandbox `directory`) this agent's session is allowed to call tools
  // from — matched by prefix against the sanitized tool names MCP.tools()
  // produces (see McpCatalog.toolName/sanitize). Absent/empty means none:
  // AgentUI sessions are conversational-only by default (see
  // AgentUI.Service.sessionPermission), same as before this field existed.
  mcpServers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Names of MCP servers this agent is allowed to call tools from. Empty/absent means none.",
  }),
  // Absent/undefined means enabled — old configs saved before this field
  // existed must keep working exactly as before. Read via isEnabled()
  // below rather than this field directly.
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether this agent is currently reachable on its channels. Missing/undefined means enabled.",
  }),
}).annotate({ identifier: "AgentUIAgent" })
export type Agent = Schema.Schema.Type<typeof Agent>

export function isEnabled(agent: Pick<Agent, "enabled">): boolean {
  return agent.enabled !== false
}

export const Info = Schema.Record(Schema.String, Agent).annotate({ identifier: "AgentUIConfig" })
export type Info = Schema.Schema.Type<typeof Info>
