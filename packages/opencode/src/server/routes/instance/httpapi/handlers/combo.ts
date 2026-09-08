import { Combo } from "@/combo"
import type { ConfigComboV1 } from "@opencode-ai/core/v1/config/combo"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const comboHandlers = HttpApiBuilder.group(InstanceHttpApi, "combo", (handlers) =>
  Effect.gen(function* () {
    const combo = yield* Combo.Service

    const list = Effect.fn("ComboHttpApi.list")(function* () {
      return yield* combo.list()
    })

    const add = Effect.fn("ComboHttpApi.add")(function* (ctx: { payload: ConfigComboV1.Combo }) {
      return yield* combo.add(ctx.payload)
    })

    const remove = Effect.fn("ComboHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      yield* combo.remove(ctx.params.id)
      return { success: true as const }
    })

    const resolve = Effect.fn("ComboHttpApi.resolve")(function* (ctx: { params: { id: string } }) {
      return yield* combo.resolve(ctx.params.id)
    })

    return handlers.handle("list", list).handle("add", add).handle("remove", remove).handle("resolve", resolve)
  }),
)
