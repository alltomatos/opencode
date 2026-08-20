import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: () => Effect.Effect<ConfigBreniacV1.Info>
  readonly set: (config: ConfigBreniacV1.Info) => Effect.Effect<ConfigBreniacV1.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Breniac") {}

const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service

    const state = yield* InstanceState.make<{ config: ConfigBreniacV1.Info }>(
      Effect.fn("Breniac.state")(function* () {
        const cfg = yield* cfgSvc.get()
        return { config: cfg.breniac ?? {} }
      }),
    )

    const get = Effect.fn("Breniac.get")(function* () {
      const s = yield* InstanceState.get(state)
      return s.config
    })

    const set = Effect.fn("Breniac.set")(function* (config: ConfigBreniacV1.Info) {
      const s = yield* InstanceState.get(state)
      s.config = config
      yield* cfgSvc.updateGlobal({ breniac: config } as ConfigV1.Info)
      return s.config
    })

    return Service.of({ get, set })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})

export * as Breniac from "."
