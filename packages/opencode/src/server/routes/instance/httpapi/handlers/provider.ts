import * as InstanceState from "@/effect/instance-state"
import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { fetchUserQuotaDetails } from "@/provider/antigravity-adapter"
import { Combo } from "@/combo"

import { mapValues } from "remeda"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginInternal } from "@opencode-ai/core/plugin/internal"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service
    const locations = yield* LocationServiceMap.Service

    // Providers registered by a Native Provider Plugin (packages/core's
    // ProviderPlugins — e.g. OmniRoute) live in the v2 Catalog, which is
    // location-scoped like file.ts/pty.ts's FileSystem/Ripgrep access, not
    // globally available.
    const withLocation = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    // Building this instance's location layer (Catalog, PluginInternal, and
    // ~28 other location-scoped services) is a real, measured ~2s of
    // synchronous work — see the NOTE below. It happens once per directory
    // and is cached (LocationServiceMap's LayerMap), but until now nothing
    // triggered it until the first request that actually needed it, which
    // in practice was usually the user opening Settings > Providers —
    // making that specific screen pay the full cost on first open every
    // session. Kick it off here instead, in the background, as soon as this
    // instance's HTTP routes are wired up (well before the user could
    // plausibly click into Settings), so it's already warm by request time.
    // Best-effort: swallow all errors, this must never affect route setup.
    yield* withLocation(Effect.void).pipe(Effect.ignore, Effect.forkScoped)

    // Catalog discovery failures (offline gateway, bad key) must never break
    // the rest of the provider list, so this is best-effort. Registering
    // built-in ProviderPlugins (e.g. OmniRoute) into the Catalog happens in
    // a forked, non-blocking fiber the first time a location boots
    // (packages/core/src/plugin/internal.ts) — reading the Catalog before
    // that fiber settles would silently miss providers that just connected
    // (the exact bug this handles). Wait for it, bounded, so a slow/hung
    // plugin can't stall this request indefinitely.
    //
    // NOTE: profiled the ~2s first-call cost of this whole endpoint. It's
    // NOT this wait (shortening the timeout to 250ms made no difference)
    // and NOT ModelsDevPlugin's transform loop (measured directly: ~270ms
    // for 207 providers / 7500+ models). Isolated it with an A/B test —
    // skipping this `withLocation` call entirely dropped total request
    // time from ~4.3s to ~2.2s. So the cost is genuinely in constructing
    // packages/core's ~30-node location-services Layer graph itself
    // (Catalog, PluginInternal, FileSystem, Watcher, Pty, SkillV2, ...) —
    // framework-level Layer/Context resolution overhead, not any single
    // plugin. See the forkScoped warm-up above, which pays this cost in
    // the background before the user can reach this endpoint instead of
    // blocking on it here.
    const catalogProviders = withLocation(
      Effect.gen(function* () {
        const internal = yield* PluginInternal.Service
        yield* internal.ready.pipe(Effect.timeout("5 seconds"), Effect.catch(() => Effect.void))
        const catalog = yield* Catalog.Service
        const all = yield* catalog.provider.all()
        const models = yield* catalog.model.all()
        return {
          providers: all.map((item) => Provider.fromCatalog(item, models.filter((model) => model.providerID === item.id))),
          available: (yield* catalog.provider.available()).map((item) => item.id),
        }
      }),
    ).pipe(Effect.catch(() => Effect.succeed({ providers: [] as Provider.Info[], available: [] as ProviderV2.ID[] })))

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const credentials = yield* authStore.all().pipe(Effect.orDie)
      const catalogData = yield* catalogProviders
      const catalogList = catalogData.providers
      const availableCatalogIds = new Set(catalogData.available)
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
        Object.fromEntries(catalogList.filter((item) => !(item.id in connected)).map((item) => [item.id, item])),
      )

      const comboSvc = yield* Combo.Service.pipe(Effect.orElseSucceed(() => undefined))
      const combos = comboSvc ? yield* comboSvc.list().pipe(Effect.orElseSucceed(() => [])) : []
      if (combos.length > 0) {
        providers["combo"] = {
          id: ProviderV2.ID.make("combo"),
          name: "Combos",
          models: Object.fromEntries(
            combos.map((c) => [
              c.id,
              {
                id: c.id,
                name: c.name,
                providerID: "combo",
                capabilities: {
                  tools: true,
                  temperature: true,
                  vision: true,
                  reasoning: true,
                  input: { text: true },
                  output: { text: true },
                },
              } as any,
            ]),
          ),
          source: "custom",
          env: [],
          options: {},
        }
      }

      const connectedIDs = Object.keys(providers).filter((id) => {
        if (id === "combo") return combos.length > 0
        if (credentials[id]) return true
        if (id in connected) {
          const item = (connected as any)[id]
          if (item?.key || item?.options?.apiKey || item?.options?.accessToken) return true
        }
        return false
      })

      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: connectedIDs.map((id) => ProviderV2.ID.make(id)),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      // OAuth connect (e.g. Anthropic Max, GitHub Copilot) writes the
      // credential directly via ProviderAuth.Service, bypassing control.ts's
      // authSet — invalidate here too so the provider list picks it up
      // immediately instead of only after the instance is recreated.
      yield* provider.invalidate()
      return true
    })

    const quota = Effect.fn("ProviderHttpApi.quota")(function* (ctx: {
      params: { providerID: string }
      query: { credentialID: string }
    }) {
      if (ctx.params.providerID === "google-antigravity-cli" || ctx.params.providerID === "google-antigravity") {
        const profile: "ide" | "cli" = ctx.params.providerID === "google-antigravity" ? "ide" : "cli"
        const details = yield* Effect.tryPromise(() => fetchUserQuotaDetails(ctx.query.credentialID, profile)).pipe(
          Effect.orElseSucceed(() => null),
        )
        return details
      }
      return null
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handle("quota", quota)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
