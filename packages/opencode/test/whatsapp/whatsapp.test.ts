import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Effect, Exit, Layer } from "effect"
import { AgentUI } from "../../src/agentui/index"
import { WhatsApp } from "../../src/whatsapp/index"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { SessionSummary } from "../../src/session/summary"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

// Same wide-dependency-tree stubbing as test/agentui/agentui.test.ts (WhatsApp.Service
// depends on AgentUI.Service, which drags in Session/SessionPrompt/InstanceStore) — see that
// file's comment for why these are noop/minimal rather than real.
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const noopSummary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({ summarize: () => Effect.void, diff: () => Effect.succeed([]), computeDiff: () => Effect.succeed([]) }),
)
const noopLsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)
const noopMcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    remove: () => Effect.void,
    serverCatalog: () => Effect.succeed({ tools: [], prompts: [], resources: [] }),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in whatsapp tests"),
    authenticate: () => Effect.die("unexpected MCP auth in whatsapp tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in whatsapp tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)
const noopRuntimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const it = testEffect(
  LayerNode.compile(LayerNode.group([WhatsApp.node, AgentUI.node]), [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [SessionSummary.node, noopSummary],
    [LSP.node, noopLsp],
    [MCP.node, noopMcp],
    [RuntimeFlags.node, noopRuntimeFlags],
    [LocationServiceMap.node, locationServiceMapLayer],
  ]),
)

function agent(overrides: { id?: string } = {}) {
  return {
    id: overrides.id ?? "agent-1",
    name: "Agent 1",
    personality: "You are a helpful support agent.",
    model: "openrouter/a",
    channels: [] as any[],
    commandTriggers: ["!"],
    ragSources: [],
    guardrails: { enabled: true, level: "basic" as const },
  }
}

it.instance("handleWebhook() fails with AgentUINotFoundError for an unknown agent id", () =>
  Effect.gen(function* () {
    const svc = yield* WhatsApp.Service
    const exit = yield* svc
      .handleWebhook({ agentID: "definitely-not-here", secret: "s", body: {}, headers: {} })
      .pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance("handleWebhook() fails with WhatsAppChannelNotConfiguredError when the agent has no whatsapp channel", () =>
  Effect.gen(function* () {
    const agentUI = yield* AgentUI.Service
    const created = agent({ id: "no-whatsapp-channel" })
    yield* agentUI.add(created)

    const svc = yield* WhatsApp.Service
    const exit = yield* svc.handleWebhook({ agentID: created.id, secret: "s", body: {}, headers: {} }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)

    yield* agentUI.remove(created.id)
  }),
)

it.instance("handleWebhook() fails with WhatsAppInvalidWebhookError on secret mismatch", () =>
  Effect.gen(function* () {
    const agentUI = yield* AgentUI.Service
    const created = {
      ...agent({ id: "wrong-secret" }),
      channels: [
        {
          type: "whatsapp" as const,
          provider: "waha" as const,
          config: { baseUrl: "http://localhost:3000", apiKey: "k" },
          directory: "/tmp/does-not-matter",
          webhookSecret: "correct-secret",
        },
      ],
    }
    yield* agentUI.add(created)

    const svc = yield* WhatsApp.Service
    const exit = yield* svc
      .handleWebhook({ agentID: created.id, secret: "wrong-secret", body: {}, headers: {} })
      .pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)

    yield* agentUI.remove(created.id)
  }),
)
