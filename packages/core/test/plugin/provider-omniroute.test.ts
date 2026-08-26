import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OmniroutePlugin, OmnirouteProviderID } from "@opencode-ai/core/plugin/provider/omniroute"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

// The plugin reads ~/.local/share/opencode/auth.json directly (see the
// comment in omniroute.ts on why it can't depend on packages/opencode's
// Auth module) — fake just the one FSUtil method it calls instead of
// touching a real file.
const addPlugin = (authData: unknown) =>
  Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    const host = yield* PluginHost.make(plugin)
    const fake = FSUtil.Service.of({ readJson: () => Effect.succeed(authData) } as unknown as FSUtil.Interface)
    yield* OmniroutePlugin.effect(host).pipe(Effect.provideService(FSUtil.Service, fake))
  })

describe("OmniroutePlugin", () => {
  it.effect("registers the omnrt provider identity in the catalog", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin({})
      const provider = yield* catalog.provider.get(OmnirouteProviderID)
      expect(provider?.name).toBe("Omniroute")
      expect(provider?.api).toEqual({ type: "aisdk", package: "@ai-sdk/openai-compatible" })
    }),
  )
})
