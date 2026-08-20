import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Breniac } from "../../src/breniac/index"
import { testEffect } from "../lib/effect"
import { Effect } from "effect"

const it = testEffect(LayerNode.compile(Breniac.node))

it.instance("set() persists config and get() reflects it immediately, without reload", () =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service

    const before = yield* breniac.get()
    expect(before).toEqual({})

    const config = {
      providerID: "omnrt",
      audioModel: "openrouter/openai/gpt-audio-mini",
      transcriptionModel: "openrouter/openai/whisper-1",
      memoryModel: "openrouter/openai/gpt-audio-mini",
    }
    yield* breniac.set(config)

    const after = yield* breniac.get()
    expect(after).toEqual(config)
  }),
  undefined,
  15000,
)

it.instance("set() overwrites the previous config entirely", () =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service

    yield* breniac.set({ providerID: "omnrt", audioModel: "openrouter/openai/gpt-audio-mini" })
    yield* breniac.set({ providerID: "omnrt", transcriptionModel: "openrouter/openai/whisper-1" })

    const config = yield* breniac.get()
    expect(config).toEqual({ providerID: "omnrt", transcriptionModel: "openrouter/openai/whisper-1" })
  }),
)
