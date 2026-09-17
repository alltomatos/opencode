// Real inference adapter for Kiro (AWS CodeWhisperer / Amazon Q Developer).
//
// Kiro's wire protocol (`generateAssistantResponse`) is a proprietary AWS
// envelope with binary AWS-EventStream streaming responses — nothing like
// OpenAI/Anthropic/Gemini's REST+SSE shape that `@ai-sdk/*` packages expect.
// Rather than writing a `LanguageModelV3` from scratch (the github-copilot
// approach), this follows the antigravity-adapter.ts pattern: register the
// v1 provider under `@ai-sdk/openai-compatible` (so the generic SDK produces
// an OpenAI chat-completions-shaped request against `${baseURL}/chat/completions`)
// and intercept that exact call with a custom `fetch` that translates it to/from
// Kiro's real envelope. OpenAI-compatible is picked (over Anthropic, kiro.ts v2's
// placeholder) because Kiro's own request/response shape — flat message list,
// `tool_calls`/`toolResults`, no native `system` role — maps far more directly
// onto OpenAI chat-completions than onto Anthropic's content-block format, so
// less translation logic has to be invented here.
//
// Protocol details (request envelope shape, binary framing, event types) were
// cross-referenced against OmniRoute's own from-scratch Kiro implementation
// (D:\dev\OmniRoute\open-sse\{executors,translator}\kiro*, read-only reference,
// not imported) which was itself reverse-engineered against live CodeWhisperer
// traffic.
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { IntegrationRotation } from "@opencode-ai/core/integration/rotation"
import { Integration } from "@opencode-ai/core/integration"
import { ByteQueue, parseEventFrame, TEXT_ENCODER } from "./kiro-eventstream"

const INTEGRATION_ID = "kiro"

// AWS SSO OIDC token region — where the OAuth client/refresh calls go. Distinct
// from the CodeWhisperer *runtime* region (see resolveRuntimeRegion below),
// which is derived from the profileArn.
const SSO_OIDC_REGION = "us-east-1"
const KIRO_PROFILE_REGIONS = ["us-east-1", "eu-central-1"]

function regionFromProfileArn(profileArn?: string): string | undefined {
  if (typeof profileArn !== "string") return undefined
  return profileArn.toLowerCase().match(/^arn:aws:codewhisperer:([a-z0-9-]+):/)?.[1]
}

/**
 * Resolves the CodeWhisperer runtime region: authoritative source is the
 * region embedded in profileArn (AWS hosts the Q Developer profile only in
 * us-east-1/eu-central-1 regardless of the IdC/OIDC token region), falling
 * back to a stored region only if it's one of those two, else us-east-1.
 */
function resolveRuntimeRegion(meta: { region?: unknown; profileArn?: unknown }): string {
  const fromArn = regionFromProfileArn(typeof meta.profileArn === "string" ? meta.profileArn : undefined)
  if (fromArn) return fromArn
  const stored = typeof meta.region === "string" ? meta.region.toLowerCase() : ""
  if (KIRO_PROFILE_REGIONS.includes(stored)) return stored
  return "us-east-1"
}

function runtimeHost(region: string): string {
  return region === "us-east-1" ? "https://codewhisperer.us-east-1.amazonaws.com" : `https://q.${region}.amazonaws.com`
}

let DatabaseConstructor: any
async function getDb(dbFile: string) {
  if (DatabaseConstructor) return new DatabaseConstructor(dbFile)
  if (typeof (process.versions as any).bun !== "undefined") {
    const mod = await import("bun:sqlite")
    DatabaseConstructor = class BunDbWrapper {
      db: any
      constructor(file: string) {
        this.db = new mod.Database(file)
      }
      prepare(sql: string) {
        const query = this.db.query(sql)
        return { all: (...args: any[]) => query.all(...args), run: (...args: any[]) => query.run(...args) }
      }
    }
  } else {
    const mod = await import("node:sqlite")
    DatabaseConstructor = mod.DatabaseSync
  }
  return new DatabaseConstructor(dbFile)
}

function toConnection(connectionId: string) {
  return { type: "credential" as const, id: connectionId as any, label: connectionId }
}

type KiroCredential = {
  access: string
  refresh?: string
  expires?: number
  metadata?: {
    authMethod?: string
    clientId?: string
    clientSecret?: string
    region?: string
    profileArn?: string
  }
}

/**
 * Refreshes an AWS SSO OIDC access token. Replicates kiro.ts v2's
 * `refreshOidcToken` rather than importing it — v1/v2 are separate runtimes
 * (same boundary antigravity-adapter.ts already respects for Google's OAuth).
 * Social-login credentials (authMethod "social") use a different refresh
 * endpoint (Kiro's own `/refreshToken`) which is not wired here — social login
 * is not the account the user connected, so it's left unimplemented and will
 * simply stop refreshing (falls through to using the possibly-expired token).
 */
async function refreshOidcToken(credential: KiroCredential, refreshToken: string) {
  const region = credential.metadata?.region || SSO_OIDC_REGION
  const clientId = credential.metadata?.clientId
  const clientSecret = credential.metadata?.clientSecret
  if (!clientId || !clientSecret) return null
  const res = await fetch(`https://oidc.${region}.amazonaws.com/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ clientId, clientSecret, grantType: "refresh_token", refreshToken }),
  })
  if (!res.ok) return null
  return (await res.json()) as { accessToken: string; refreshToken?: string; expiresIn: number }
}

async function getLiveCredential(): Promise<{
  access: string
  profileArn?: string
  region: string
  connectionId?: string
  exhausted?: boolean
}> {
  try {
    const dbFile = CoreDatabase.path()
    const db = await getDb(dbFile)
    const rows = db
      .prepare("SELECT id, value FROM credential WHERE integration_id = ? ORDER BY time_updated ASC")
      .all(INTEGRATION_ID) as { id: string; value: string }[]
    if (!rows.length) return { access: "", region: SSO_OIDC_REGION }

    const connections = rows.map((r) => ({ type: "credential" as const, id: r.id as any, label: r.id }))
    if (connections.every((c) => !IntegrationRotation.isAvailable(c))) {
      return { access: "", region: SSO_OIDC_REGION, exhausted: true }
    }

    const picked = IntegrationRotation.pick(Integration.ID.make(INTEGRATION_ID), connections)
    const selectedId = picked?.type === "credential" ? picked.id : undefined
    const selectedRow = rows.find((r) => r.id === selectedId) ?? rows[0]

    const parsed = JSON.parse(selectedRow.value) as KiroCredential
    const now = Date.now()
    let access = parsed.access

    if (parsed.refresh && parsed.metadata?.authMethod !== "social" && (!parsed.expires || parsed.expires - now < 120_000)) {
      const refreshed = await refreshOidcToken(parsed, parsed.refresh)
      if (refreshed) {
        access = refreshed.accessToken
        parsed.access = access
        parsed.refresh = refreshed.refreshToken ?? parsed.refresh
        parsed.expires = Date.now() + refreshed.expiresIn * 1000
        db.prepare("UPDATE credential SET value = ?, time_updated = ? WHERE id = ?").run(
          JSON.stringify(parsed),
          Date.now(),
          selectedRow.id,
        )
      }
    }

    const region = resolveRuntimeRegion(parsed.metadata ?? {})
    return { access, profileArn: parsed.metadata?.profileArn, region, connectionId: selectedRow.id }
  } catch {
    return { access: "", region: SSO_OIDC_REGION }
  }
}

/** Reuses rotation.ts's own error classification instead of re-deriving cooldowns here. */
function benchOnFailure(connectionId: string | undefined, status: number, bodyText: string) {
  if (!connectionId) return
  let awsCode: string | undefined
  try {
    awsCode = JSON.parse(bodyText)?.__type
  } catch {}
  const errorLike: any =
    awsCode?.includes("Throttling") || status === 429
      ? { _tag: "RateLimit" }
      : status === 403 || awsCode?.includes("AccessDenied")
        ? { _tag: "Authentication", kind: "invalid" }
        : { status, message: bodyText }
  const check = IntegrationRotation.isBenchableFailure(errorLike)
  if (check.bench) IntegrationRotation.markUnavailable(toConnection(connectionId), check.durationMs)
}

// -- Request envelope construction (OpenAI chat-completions -> Kiro) --------

type OAIMessage = {
  role: string
  content?: string | Array<Record<string, unknown>>
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

type KiroTurn =
  | { userInputMessage: { content: string; modelId: string; origin: string; userInputMessageContext?: any } }
  | { assistantResponseMessage: { content: string; toolUses?: any[] } }

function textOf(content: OAIMessage["content"]): string {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content
      .filter((c) => c["type"] === "text" || typeof c["text"] === "string")
      .map((c) => (c["text"] as string) || "")
      .join("\n")
  return ""
}

/**
 * Builds the Kiro `conversationState` envelope from an OpenAI chat-completions
 * request. Deliberately simpler than OmniRoute's port: no image attachments,
 * and tool-result batching assumes one `tool` message per preceding
 * `tool_calls` entry rather than reconstructing interleaved batches — good
 * enough for a single-turn tool round-trip, documented as a known gap for
 * more exotic multi-tool-batch histories.
 */
function buildConversationState(
  messages: OAIMessage[],
  tools: Array<{ function: { name: string; description?: string; parameters?: unknown } }> | undefined,
  model: string,
) {
  const turns: KiroTurn[] = []
  let toolsAttached = false
  let systemText = ""

  const toolSpecs = (tools ?? []).map((t) => ({
    toolSpecification: {
      name: t.function.name,
      description: t.function.description?.slice(0, 10000) || `Tool: ${t.function.name}`,
      inputSchema: { json: t.function.parameters ?? { type: "object", properties: {} } },
    },
  }))

  for (const msg of messages) {
    if (msg.role === "system") {
      systemText += (systemText ? "\n\n" : "") + `<system-reminder>\n${textOf(msg.content)}\n</system-reminder>`
      continue
    }
    if (msg.role === "user") {
      turns.push({
        userInputMessage: { content: textOf(msg.content), modelId: model, origin: "AI_EDITOR" },
      })
      continue
    }
    if (msg.role === "assistant") {
      const toolUses = (msg.tool_calls ?? []).map((tc, idx) => ({
        toolUseId: tc.id || `call_${idx}`,
        name: tc.function.name,
        input: (() => {
          try {
            return JSON.parse(tc.function.arguments || "{}")
          } catch {
            return {}
          }
        })(),
      }))
      turns.push({
        assistantResponseMessage: { content: textOf(msg.content) || "(empty)", ...(toolUses.length ? { toolUses } : {}) },
      })
      continue
    }
    if (msg.role === "tool") {
      turns.push({
        userInputMessage: {
          content: "",
          modelId: model,
          origin: "AI_EDITOR",
          userInputMessageContext: {
            toolResults: [{ toolUseId: msg.tool_call_id, status: "success", content: [{ text: textOf(msg.content) }] }],
          },
        },
      })
      continue
    }
  }

  // Merge consecutive same-role turns (Kiro rejects non-alternating history).
  const merged: KiroTurn[] = []
  for (const turn of turns) {
    const prev = merged[merged.length - 1]
    if ("userInputMessage" in turn && prev && "userInputMessage" in prev) {
      prev.userInputMessage.content = [prev.userInputMessage.content, turn.userInputMessage.content].filter(Boolean).join("\n\n")
      if (turn.userInputMessage.userInputMessageContext) {
        prev.userInputMessage.userInputMessageContext = {
          ...(prev.userInputMessage.userInputMessageContext ?? {}),
          toolResults: [
            ...(prev.userInputMessage.userInputMessageContext?.toolResults ?? []),
            ...(turn.userInputMessage.userInputMessageContext.toolResults ?? []),
          ],
        }
      }
      continue
    }
    if ("assistantResponseMessage" in turn && prev && "assistantResponseMessage" in prev) {
      prev.assistantResponseMessage.content = [prev.assistantResponseMessage.content, turn.assistantResponseMessage.content]
        .filter(Boolean)
        .join("\n\n")
      if (turn.assistantResponseMessage.toolUses) {
        prev.assistantResponseMessage.toolUses = [
          ...(prev.assistantResponseMessage.toolUses ?? []),
          ...turn.assistantResponseMessage.toolUses,
        ]
      }
      continue
    }
    merged.push(turn)
  }

  // Last turn becomes currentMessage; Kiro requires it to be a user turn.
  let current = merged.pop()
  if (!current || !("userInputMessage" in current)) {
    if (current) merged.push(current)
    current = { userInputMessage: { content: "...", modelId: model, origin: "AI_EDITOR" } }
  }

  if (systemText) {
    current.userInputMessage.content = current.userInputMessage.content
      ? `${systemText}\n\n${current.userInputMessage.content}`
      : systemText
  }

  if (toolSpecs.length && "userInputMessage" in current) {
    current.userInputMessage.userInputMessageContext = {
      ...(current.userInputMessage.userInputMessageContext ?? {}),
      tools: toolSpecs,
    }
    toolsAttached = true
  }
  void toolsAttached

  // Ensure alternation in the remaining history (insert synthetic filler turns).
  const history: KiroTurn[] = []
  for (const turn of merged) {
    const prev = history[history.length - 1]
    const sameKind = prev && Object.keys(prev)[0] === Object.keys(turn)[0]
    if (sameKind) {
      history.push(
        "userInputMessage" in turn
          ? { assistantResponseMessage: { content: "(empty)" } }
          : { userInputMessage: { content: "(empty)", modelId: model, origin: "AI_EDITOR" } },
      )
    }
    history.push(turn)
  }
  if (history.length && "assistantResponseMessage" in history[0]) {
    history.unshift({ userInputMessage: { content: "(empty)", modelId: model, origin: "AI_EDITOR" } })
  }

  return {
    chatTriggerType: "MANUAL" as const,
    conversationId: crypto.randomUUID(),
    currentMessage: current,
    history,
  }
}

// -- Response translation (binary AWS EventStream -> OpenAI SSE) ------------

function sseChunk(obj: unknown): Uint8Array {
  return TEXT_ENCODER.encode(`data: ${JSON.stringify(obj)}\n\n`)
}

/**
 * Translates the raw CodeWhisperer binary EventStream response into an
 * OpenAI chat-completions SSE stream, the shape `@ai-sdk/openai-compatible`
 * expects on the other end of this fetch.
 *
 * Scope cut for the first working version: `toolUseEvent.input` fragments are
 * buffered and only the final canonical JSON is emitted (matches Kiro's
 * "partial object that grows" behavior — see OmniRoute's kiro executor for
 * why naive incremental emission produces unparseable overlapping JSON).
 * `reasoningContentEvent` is NOT mapped to `reasoning_content` yet — reasoning
 * is dropped on the floor for now (documented gap, see final report).
 */
function transformKiroStream(upstream: Response, model: string): Response {
  const buffer = new ByteQueue()
  const responseId = `chatcmpl-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  let chunkIndex = 0
  let hasToolCalls = false
  const seenToolIndex = new Map<string, number>()
  const toolArgsBuffered = new Map<string, { toolIndex: number; canonical: string }>()
  let toolCallIndex = 0

  const flushToolArgs = (controller: TransformStreamDefaultController) => {
    for (const [, info] of toolArgsBuffered) {
      controller.enqueue(
        sseChunk({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: info.toolIndex, function: { arguments: info.canonical } }] },
              finish_reason: null,
            },
          ],
        }),
      )
    }
    toolArgsBuffered.clear()
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer.push(chunk)
      let iterations = 0
      while (buffer.length >= 16 && iterations < 1000) {
        iterations++
        const totalLength = buffer.peekUint32BE(0)
        if (!totalLength || totalLength < 16 || totalLength > buffer.length) break
        const eventData = buffer.read(totalLength)
        if (!eventData) break
        const event = parseEventFrame(eventData)
        if (!event) continue

        const eventType = event.headers[":event-type"] || ""
        const payload = event.payload as Record<string, unknown> | undefined

        if (eventType === "assistantResponseEvent") {
          const content = typeof payload?.["content"] === "string" ? (payload["content"] as string) : ""
          if (content) {
            controller.enqueue(
              sseChunk({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  { index: 0, delta: chunkIndex === 0 ? { role: "assistant", content } : { content }, finish_reason: null },
                ],
              }),
            )
            chunkIndex++
          }
        }

        if (eventType === "toolUseEvent" && payload) {
          hasToolCalls = true
          const toolUseId = typeof payload["toolUseId"] === "string" ? (payload["toolUseId"] as string) : `call_${chunkIndex}`
          const name = payload["name"] as string | undefined
          let toolIndex = seenToolIndex.get(toolUseId)
          if (toolIndex === undefined) {
            toolIndex = toolCallIndex++
            seenToolIndex.set(toolUseId, toolIndex)
            controller.enqueue(
              sseChunk({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      ...(chunkIndex === 0 ? { role: "assistant" } : {}),
                      tool_calls: [{ index: toolIndex, id: toolUseId, type: "function", function: { name, arguments: "" } }],
                    },
                    finish_reason: null,
                  },
                ],
              }),
            )
            chunkIndex++
          }
          const input = payload["input"]
          if (typeof input === "string") {
            controller.enqueue(
              sseChunk({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  { index: 0, delta: { tool_calls: [{ index: toolIndex, function: { arguments: input } }] }, finish_reason: null },
                ],
              }),
            )
          } else if (input && typeof input === "object") {
            toolArgsBuffered.set(toolUseId, { toolIndex, canonical: JSON.stringify(input) })
          }
        }

        if (eventType === "messageStopEvent") {
          flushToolArgs(controller)
        }
      }
    },
    flush(controller) {
      flushToolArgs(controller)
      controller.enqueue(
        sseChunk({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: hasToolCalls ? "tool_calls" : "stop" }],
        }),
      )
      controller.enqueue(TEXT_ENCODER.encode("data: [DONE]\n\n"))
    },
  })

  const body = upstream.body?.pipeThrough(transform)
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  })
}

// -- Public entry point -------------------------------------------------------

/**
 * Builds the `fetch` implementation injected into the "kiro" `@ai-sdk/openai-compatible`
 * loader. Only intercepts the `/chat/completions` call the SDK makes; anything
 * else passes straight through to the real `fetch` (mirrors createAntigravityFetch).
 */
export function createKiroFetch(getOptions?: () => Record<string, any>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!urlStr.includes("/chat/completions")) return fetch(input, init)

    const reqBody = typeof init?.body === "string" ? JSON.parse(init.body) : {}
    const model: string = reqBody.model
    const messages: OAIMessage[] = reqBody.messages ?? []
    const tools = reqBody.tools

    const opts = getOptions?.() ?? {}
    let access = opts["apiKey"]
    let profileArn = opts["profileArn"]
    let region = opts["region"]
    let usedConnectionId: string | undefined

    if (!access || access === "kiro-oauth" || !profileArn) {
      const live = await getLiveCredential()
      if (live.exhausted) {
        return new Response(
          JSON.stringify({ error: { message: "Todas as contas Kiro atingiram o limite; aguarde o reset.", type: "rate_limit" } }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        )
      }
      if (live.access) access = live.access
      if (!profileArn) profileArn = live.profileArn
      if (!region) region = live.region
      usedConnectionId = live.connectionId
    }
    region = region || SSO_OIDC_REGION

    const conversationState = buildConversationState(messages, tools, model)
    const envelope: Record<string, unknown> = {
      conversationState,
      ...(profileArn ? { profileArn } : {}),
      inferenceConfig: {
        ...(reqBody.max_tokens ? { maxTokens: reqBody.max_tokens } : {}),
        ...(reqBody.temperature !== undefined ? { temperature: reqBody.temperature } : {}),
        ...(reqBody.top_p !== undefined ? { topP: reqBody.top_p } : {}),
      },
    }

    const url = `${runtimeHost(region)}/generateAssistantResponse`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/vnd.amazon.eventstream",
      "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
      "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": crypto.randomUUID(),
    }
    if (access) headers["Authorization"] = `Bearer ${access}`

    let upstream: Response
    try {
      upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(envelope), signal: init?.signal })
    } catch (e) {
      return new Response(String(e), { status: 502 })
    }

    if (!upstream.ok) {
      const bodyText = await upstream
        .clone()
        .text()
        .catch(() => "")
      benchOnFailure(usedConnectionId, upstream.status, bodyText)
      // Propagate as an OpenAI-shaped error body so the generic SDK's error
      // parsing doesn't choke on a raw AWS JSON-RPC error shape.
      return new Response(JSON.stringify({ error: { message: bodyText || upstream.statusText, type: "upstream_error" } }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (!upstream.body) return upstream
    return transformKiroStream(upstream, model)
  }
}
