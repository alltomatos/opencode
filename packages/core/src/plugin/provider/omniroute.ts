import { Duration, Effect } from "effect"
import path from "node:path"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

// Registers the "omnrt" provider identity in the catalog and, once a
// credential is connected (see #93 for the connect-flow UI), discovers
// its models dynamically from /v1/models — replacing the static
// provider/model snapshot the desktop app used to write into
// opencode.json at connect time. See ADR 0002.
//
// SDK instantiation itself is already handled generically by
// OpenAICompatiblePlugin for any provider using the
// "@ai-sdk/openai-compatible" package, omnrt included — this plugin only
// needs the catalog registration + discovery, no aisdk.sdk wiring of its own.
export const OmnirouteProviderID = ProviderV2.ID.make("omnrt")

// The credential the connect flow writes lives in the legacy
// packages/opencode/src/auth store (~/.local/share/opencode/auth.json),
// which every other provider's inference-time request already reads —
// packages/core can't import that module (packages/opencode depends on
// packages/core, never the reverse; moving the module the other way
// touches 30+ files and the LayerNode dependency graph, out of scope
// here — see the "não fazer" note in docs/agents/omniroute-native-provider.md).
// Read the same file directly instead, mirroring the one field shape this
// plugin needs, the same way GithubCopilotPlugin owns its own credential
// access outside the generic plugin sandbox.
type StoredApiAuth = { readonly type: "api"; readonly key: string; readonly metadata?: Record<string, string> }

function readAuthCredential(fs: FSUtil.Interface, providerID: string) {
  return fs.readJson(path.join(Global.Path.data, "auth.json")).pipe(
    Effect.map((data) => {
      const entry = (data as Record<string, unknown> | undefined)?.[providerID]
      if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "api") return undefined
      return entry as StoredApiAuth
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

// Gemini models (via OmniRoute) reject full JSON-Schema tool parameters —
// only a subset is accepted, so $schema/$ref/additionalProperties must be
// stripped before the request goes out. Registered as `item.api.settings.fetch`
// (packages/core/src/aisdk.ts's prepareOptions already threads that through
// to the real network call), scoped to model ids containing "gemini" only.
function stripSchemaKeys(schema: Record<string, unknown>): void {
  delete schema.$schema
  delete schema.$ref
  delete schema.additionalProperties
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") stripSchemaKeys(item as Record<string, unknown>)
      }
    } else if (value && typeof value === "object") {
      stripSchemaKeys(value as Record<string, unknown>)
    }
  }
}

function sanitizeGeminiToolSchemas(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload
  const body = payload as { tools?: Array<{ function?: { parameters?: unknown } }> }
  if (!Array.isArray(body.tools)) return payload
  for (const tool of body.tools) {
    const parameters = tool.function?.parameters
    if (parameters && typeof parameters === "object") stripSchemaKeys(parameters as Record<string, unknown>)
  }
  return payload
}

// One fetch override registered per-provider (not per-model — the provider
// entry has no per-request model context), so the model id has to be read
// back out of the outgoing request body itself (every AI SDK chat-completions
// call includes it as `body.model`).
export const geminiSanitizingFetch = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  if (typeof init?.body !== "string") return fetch(input, init)
  try {
    const payload = JSON.parse(init.body) as { model?: unknown }
    if (typeof payload.model !== "string" || !payload.model.includes("gemini")) return fetch(input, init)
    const cleaned = sanitizeGeminiToolSchemas(payload)
    return fetch(input, { ...init, body: JSON.stringify(cleaned) })
  } catch {
    // Fail open — a sanitizer bug must never break the request path.
    return fetch(input, init)
  }
}

// Restricts which discovered models (combos included, #92) actually get
// registered in the catalog — checked before catalog.model.update, so a
// model outside the allowlist is silently skipped at registration, not
// removed after the fact. Absent/empty allowlist = current behaviour (every
// discovered model registers).
export function resolveModelAllowlist(configured: unknown): Set<string> | undefined {
  if (!Array.isArray(configured) || configured.length === 0) return undefined
  const ids = configured.filter((id): id is string => typeof id === "string")
  return ids.length ? new Set(ids) : undefined
}

const DISCOVERY_TTL_MS = 5 * 60_000
const MIN_AUTO_SYNC_MS = 60_000
const DEFAULT_AUTO_SYNC_MS = 5 * 60_000

// Clamps a configured auto-sync interval to the same floor the original
// external plugin enforced (autoSyncIntervalMs, min 60s) — 0 disables
// background sync entirely (on-demand TTL discovery still applies).
export function resolveAutoSyncMs(configured: number | undefined): number | undefined {
  if (configured === undefined) return DEFAULT_AUTO_SYNC_MS
  if (configured === 0) return undefined
  return Math.max(configured, MIN_AUTO_SYNC_MS)
}

type OmnirouteModel = {
  readonly id: string
  readonly owned_by?: string
  readonly input_modalities?: readonly string[]
  readonly output_modalities?: readonly string[]
  readonly capabilities?: {
    readonly vision?: boolean
    readonly tool_calling?: boolean
    readonly reasoning?: boolean
    readonly thinking?: boolean
    readonly temperature?: boolean
  }
}

const KNOWN_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const
function modalities(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return values.filter((value): value is (typeof KNOWN_MODALITIES)[number] =>
    (KNOWN_MODALITIES as readonly string[]).includes(value),
  )
}

async function fetchModels(baseURL: string, apiKey: string): Promise<OmnirouteModel[]> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const body = (await response.json()) as { data?: OmnirouteModel[] }
  return body.data ?? []
}

// Overlays display name + pricing onto the ModelV2 entries /v1/models
// already produced — solves the "raw id in UI" complaint without a
// client-side heuristic. Best-effort: a failure here must never block
// discovery of the models themselves, so it's always wrapped and caught by
// the caller, never thrown into the main discovery path.
type OmnirouteModelPricing = {
  readonly id: string
  readonly name?: string
  readonly pricing?: {
    readonly input?: number
    readonly output?: number
    readonly cache_read?: number
    readonly cache_write?: number
  }
}

async function fetchPricing(baseURL: string, apiKey: string): Promise<Map<string, OmnirouteModelPricing>> {
  const origin = new URL(baseURL).origin
  const response = await fetch(`${origin}/api/pricing/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const body = (await response.json()) as { data?: OmnirouteModelPricing[] }
  return new Map((body.data ?? []).map((entry) => [entry.id, entry]))
}

export const OmniroutePlugin = {
  id: "omniroute",
  effect: Effect.fn(function* (ctx: PluginContext) {
    const fs = yield* FSUtil.Service
    // Scoped to this plugin instance (one per boot), not module-level —
    // shared across every Catalog Reload within that boot (the TTL/
    // auto-sync mechanism), but never leaks across separate boots/tests.
    let cache:
      | {
          readonly at: number
          readonly models: readonly OmnirouteModel[]
          readonly pricing: ReadonlyMap<string, OmnirouteModelPricing>
        }
      | undefined

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        catalog.provider.update(OmnirouteProviderID, (item) => {
          item.name = "Omniroute"
          if (item.api.type !== "aisdk" || item.api.package !== "@ai-sdk/openai-compatible") {
            item.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          }
        })

        const stored = yield* readAuthCredential(fs, OmnirouteProviderID)
        if (!stored) return
        const apiKey = stored.key
        const baseURL = stored.metadata?.baseURL
        if (!baseURL) return

        catalog.provider.update(OmnirouteProviderID, (item) => {
          if (item.api.type === "aisdk") {
            item.api = { ...item.api, url: baseURL, settings: { ...item.api.settings, fetch: geminiSanitizingFetch } }
          }
        })

        const now = Date.now()
        if (!cache || now - cache.at > DISCOVERY_TTL_MS) {
          const fetched = yield* Effect.tryPromise(() => fetchModels(baseURL, apiKey)).pipe(
            // A gateway that's offline or a stale/invalid key must not wipe
            // the last known-good catalog — keep serving it until discovery
            // succeeds again (see docs/agents/omniroute-native-provider.md).
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (fetched) {
            // Best-effort — a broken/missing pricing endpoint must not stop
            // the models themselves from registering.
            const pricing = yield* Effect.tryPromise(() => fetchPricing(baseURL, apiKey)).pipe(
              Effect.catch(() => Effect.succeed(new Map<string, OmnirouteModelPricing>())),
            )
            cache = { at: now, models: fetched, pricing }
          }
        }
        if (!cache) return

        const allowlist = resolveModelAllowlist(ctx.options.modelAllowlist)

        for (const model of cache.models) {
          if (allowlist && !allowlist.has(model.id)) continue
          // Combos (owned_by === "combo" — a routed composition of multiple
          // real models, not a model of its own) register the same way as
          // any other model: the gateway is the source of truth for their
          // capabilities (already LCD'd server-side across whatever models
          // the combo composes), so there's no client-side capability math
          // to redo here.
          const priced = cache.pricing.get(model.id)
          catalog.model.update(OmnirouteProviderID, ModelV2.ID.make(model.id), (entry) => {
            entry.capabilities = {
              tools: model.capabilities?.tool_calling ?? false,
              input: modalities(model.input_modalities),
              output: modalities(model.output_modalities),
            }
            if (priced?.name) entry.name = priced.name
            if (priced?.pricing) {
              entry.cost = [
                {
                  input: priced.pricing.input ?? 0,
                  output: priced.pricing.output ?? 0,
                  cache: { read: priced.pricing.cache_read ?? 0, write: priced.pricing.cache_write ?? 0 },
                },
              ]
            }
          })
        }
      }),
    )

    // Background auto-sync: reruns the transform above on an interval, so
    // newly-added gateway models show up without the user reconnecting.
    // On-demand TTL discovery (above) still applies independently — this
    // is only skipped when autoSyncIntervalMs resolves to 0.
    const autoSyncMs = resolveAutoSyncMs(
      typeof ctx.options.autoSyncIntervalMs === "number" ? ctx.options.autoSyncIntervalMs : undefined,
    )
    if (autoSyncMs !== undefined) {
      yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(Duration.millis(autoSyncMs))
          // A periodic tick must force a fresh fetch even if the on-demand
          // TTL window (DISCOVERY_TTL_MS) hasn't lapsed yet — that's the
          // whole point of scheduling it — so expire the cache first.
          cache = undefined
          yield* ctx.catalog.reload().pipe(Effect.catch(() => Effect.void))
        }
      }).pipe(Effect.forkScoped)
    }
  }),
}
