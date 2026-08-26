import { detectExternalAgents } from "@opencode-ai/core/external-agent-detect"
import { KNOWN_EXTERNAL_AGENTS } from "@opencode-ai/core/external-agent-registry"
import { installBatutaCliSkill, removeBatutaCliSkill } from "@opencode-ai/core/external-agent-skill"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const externalAgentHandlers = HttpApiBuilder.group(InstanceHttpApi, "externalAgent", (handlers) =>
  Effect.gen(function* () {
    const detect = Effect.fn("ExternalAgentHttpApi.detect")(function* () {
      return yield* Effect.promise(() => detectExternalAgents())
    })

    const setSkill = Effect.fn("ExternalAgentHttpApi.setSkill")(function* (ctx: {
      params: { id: string }
      payload: { install: boolean }
    }) {
      const agent = KNOWN_EXTERNAL_AGENTS.find((known) => known.id === ctx.params.id)
      if (!agent) return { installed: false }
      yield* Effect.promise(() =>
        ctx.payload.install
          ? installBatutaCliSkill(agent, Global.Path.home)
          : removeBatutaCliSkill(agent, Global.Path.home),
      )
      return { installed: ctx.payload.install }
    })

    return handlers.handle("detect", detect).handle("setSkill", setSkill)
  }),
)
