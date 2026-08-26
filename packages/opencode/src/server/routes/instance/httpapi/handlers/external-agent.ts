import { detectExternalAgents } from "@opencode-ai/core/external-agent-detect"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const externalAgentHandlers = HttpApiBuilder.group(InstanceHttpApi, "externalAgent", (handlers) =>
  Effect.gen(function* () {
    const detect = Effect.fn("ExternalAgentHttpApi.detect")(function* () {
      return yield* Effect.promise(() => detectExternalAgents())
    })

    return handlers.handle("detect", detect)
  }),
)
