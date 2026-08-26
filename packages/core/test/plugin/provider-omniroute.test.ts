import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* OmniroutePlugin.effect(host)
})

describe("OmniroutePlugin", () => {
  it.effect("registers the omnrt provider identity in the catalog", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.name).toBe("Omniroute")
      expect(provider?.api).toEqual({ type: "aisdk", package: "@ai-sdk/openai-compatible" })
    }),
  )
})
