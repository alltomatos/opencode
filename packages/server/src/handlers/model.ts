import { Catalog } from "@opencode-ai/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

function cleanModel(model: any) {
  if (model?.api?.settings && typeof model.api.settings === "object") {
    const { fetch: _, ...safeSettings } = model.api.settings
    return {
      ...model,
      api: {
        ...model.api,
        settings: safeSettings,
      },
    }
  }
  return model
}

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "model.list",
      Effect.fn(function* () {
        const catalog = yield* Catalog.Service
        const list = yield* catalog.model.available()
        return yield* response(Effect.succeed(list.map(cleanModel)))
      }),
    )
  }),
)

