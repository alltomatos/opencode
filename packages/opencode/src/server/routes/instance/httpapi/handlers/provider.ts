import * as InstanceState from "@/effect/instance-state"
import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"

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

    // Catalog discovery failures (offline gateway, bad key) must never break
    // the rest of the provider list, so this is best-effort. Registering
    // built-in ProviderPlugins (e.g. OmniRoute) into the Catalog happens in
    // a forked, non-blocking fiber the first time a location boots
    // (packages/core/src/plugin/internal.ts) — reading the Catalog before
    // that fiber settles would silently miss providers that just connected
    // (the exact bug this handles). Wait for it, bounded, so a slow/hung
    // plugin can't stall this request indefinitely.
    //
    // NOTE: profiled the ~2.3s first-call cost of this whole endpoint —
    // it's NOT this wait (shortening the timeout here to 250ms made no
    // measurable difference). The actual cost is inside catalog.provider
    // .all()/catalog.model.all() below, which appears to synchronously run
    // ModelsDevPlugin's full catalog transform (~207 providers × their
    // models) on first call. Fixing that is a packages/core Catalog-service
    // change, out of scope for this pass — left as a follow-up.
    const catalogProviders = withLocation(
      Effect.gen(function* () {
        const internal = yield* PluginInternal.Service
        yield* internal.ready.pipe(Effect.timeout("5 seconds"), Effect.catch(() => Effect.void))
        const catalog = yield* Catalog.Service
        const all = yield* catalog.provider.all()
        const models = yield* catalog.model.all()
        return all.map((item) => Provider.fromCatalog(item, models.filter((model) => model.providerID === item.id)))
      }),
    ).pipe(Effect.catch(() => Effect.succeed([] as Provider.Info[])))

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
      const catalogList = yield* catalogProviders
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
        Object.fromEntries(catalogList.filter((item) => !(item.id in connected)).map((item) => [item.id, item])),
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        // catalogList membership is NOT proof of a real connection: both
        // ModelsDevPlugin (every known models.dev provider) and OmniRoute's
        // own plugin (packages/core/src/plugin/provider/omniroute.ts —
        // registers "omnrt" into the catalog before it even checks for a
        // stored credential) populate the same v2 Catalog unconditionally.
        // OmniRoute's credential lives in the exact same auth.json file
        // `authStore` reads (see readAuthCredential there), so
        // credentials[id] already reflects it live — catalogList adds
        // nothing but false positives here.
        connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
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

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
