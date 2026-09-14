import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const credentials = yield* Credential.Service
        const result = yield* credentials.create({
          integrationID: ctx.payload.integrationID,
          label: ctx.payload.label,
          value: ctx.payload.value,
        })
        yield* Effect.logInfo(`Credential created for integration ${ctx.payload.integrationID} (${result.id})`)
        return result
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        yield* (yield* Integration.Service).connection.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* Integration.Service).connection.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
