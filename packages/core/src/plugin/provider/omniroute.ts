import { Duration, Effect } from "effect"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { Credential } from "../../credential"
import { Integration } from "@opencode-ai/schema/integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

// Registers the "omnrt" provider identity in the catalog and, once a
// credential is connected (see #93 for the connect-flow UI), discovers
// its models dynamically from /v1/models — replacing the static
// provider/model snapshot the desktop app used to write into
// opencode.json at connect time. See ADR 0002 and ADR 0003.
//
// SDK instantiation itself is already handled generically by
// OpenAICompatiblePlugin for any provider using the
// "@ai-sdk/openai-compatible" package, omnrt included — this plugin only
// needs the catalog registration + discovery, no aisdk.sdk wiring of its own.
export const OmnirouteProviderID = ProviderV2.ID.make("omnrt")
const OmnirouteIntegrationID = Integration.ID.make("omnrt")

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

export const OmniroutePlugin = {
  id: "omniroute",
  effect: Effect.fn(function* (ctx: PluginContext) {
    const credential = yield* Credential.Service
    // Scoped to this plugin instance (one per boot), not module-level —
    // shared across every Catalog Reload within that boot (the TTL/
    // auto-sync mechanism), but never leaks across separate boots/tests.
    let cache: { readonly at: number; readonly models: readonly OmnirouteModel[] } | undefined

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        catalog.provider.update(OmnirouteProviderID, (item) => {
          item.name = "Omniroute"
          if (item.api.type !== "aisdk" || item.api.package !== "@ai-sdk/openai-compatible") {
            item.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
          }
        })

        const creds = yield* credential.list(OmnirouteIntegrationID).pipe(Effect.orDie)
        const stored = creds[0]
        if (!stored || stored.value.type !== "key") return
        const apiKey = stored.value.key
        const baseURL = typeof stored.value.metadata?.baseURL === "string" ? stored.value.metadata.baseURL : undefined
        if (!baseURL) return

        catalog.provider.update(OmnirouteProviderID, (item) => {
          if (item.api.type === "aisdk") item.api = { ...item.api, url: baseURL }
        })

        const now = Date.now()
        if (!cache || now - cache.at > DISCOVERY_TTL_MS) {
          const fetched = yield* Effect.tryPromise(() => fetchModels(baseURL, apiKey)).pipe(
            // A gateway that's offline or a stale/invalid key must not wipe
            // the last known-good catalog — keep serving it until discovery
            // succeeds again (see docs/agents/omniroute-native-provider.md).
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (fetched) cache = { at: now, models: fetched }
        }
        if (!cache) return

        for (const model of cache.models) {
          // Combos (owned_by === "combo" — a routed composition of multiple
          // real models, not a model of its own) register the same way as
          // any other model: the gateway is the source of truth for their
          // capabilities (already LCD'd server-side across whatever models
          // the combo composes), so there's no client-side capability math
          // to redo here.
          catalog.model.update(OmnirouteProviderID, ModelV2.ID.make(model.id), (entry) => {
            entry.capabilities = {
              tools: model.capabilities?.tool_calling ?? false,
              input: modalities(model.input_modalities),
              output: modalities(model.output_modalities),
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
