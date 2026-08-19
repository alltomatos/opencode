import { Batuta } from "@/batuta"
import type { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { BatutaActivityNotFoundError } from "../errors"

export const batutaHandlers = HttpApiBuilder.group(InstanceHttpApi, "batuta", (handlers) =>
  Effect.gen(function* () {
    const batuta = yield* Batuta.Service

    const list = Effect.fn("BatutaHttpApi.list")(function* () {
      return yield* batuta.list()
    })

    const add = Effect.fn("BatutaHttpApi.add")(function* (ctx: { payload: ConfigBatutaV1.Activity }) {
      return yield* batuta.add(ctx.payload)
    })

    const remove = Effect.fn("BatutaHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      yield* batuta.remove(ctx.params.id)
      return { success: true as const }
    })

    const start = Effect.fn("BatutaHttpApi.start")(function* (ctx: { params: { id: string } }) {
      const result = yield* batuta.start(ctx.params.id).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      return { sessionID: result.sessionID }
    })

    return handlers.handle("list", list).handle("add", add).handle("remove", remove).handle("start", start)
  }),
)
