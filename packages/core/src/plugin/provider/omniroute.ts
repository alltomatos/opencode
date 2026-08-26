import { Effect } from "effect"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { ProviderV2 } from "../../provider"

// Registers the "omnrt" provider identity in the catalog — the actual SDK
// instantiation is already handled generically by OpenAICompatiblePlugin for
// any provider using the "@ai-sdk/openai-compatible" package, omnrt included.
// See ADR 0002 (docs/adr/0002-omniroute-provider-nativo-nao-plugin-npm.md):
// this replaces the static provider/model snapshot the desktop app used to
// write into opencode.json at connect time.
export const OmnirouteProviderID = ProviderV2.ID.make("omnrt")

export const OmniroutePlugin = {
  id: "omniroute",
  effect: Effect.fn(function* (ctx: PluginContext) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        catalog.provider.update(OmnirouteProviderID, (item) => {
          item.name = "Omniroute"
          item.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
      }),
    )
  }),
}
