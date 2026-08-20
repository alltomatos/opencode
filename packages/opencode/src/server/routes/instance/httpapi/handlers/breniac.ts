import { Breniac } from "@/breniac"
import { Provider } from "@/provider/provider"
import type { ConfigBreniacV1 } from "@opencode-ai/core/v1/config/breniac"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { UpstreamError } from "../errors"
import { InstanceHttpApi } from "../api"
import type { TranscribeRequest } from "../groups/breniac"

// Cloudflare (fronting Omniroute) blocks requests without a browser-like User-Agent.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

export const breniacHandlers = HttpApiBuilder.group(InstanceHttpApi, "breniac", (handlers) =>
  Effect.gen(function* () {
    const breniac = yield* Breniac.Service
    const provider = yield* Provider.Service

    const getConfig = Effect.fn("BreniacHttpApi.getConfig")(function* () {
      return yield* breniac.get()
    })

    const setConfig = Effect.fn("BreniacHttpApi.setConfig")(function* (ctx: { payload: ConfigBreniacV1.Info }) {
      return yield* breniac.set(ctx.payload)
    })

    const transcribe = Effect.fn("BreniacHttpApi.transcribe")(function* (ctx: { payload: TranscribeRequest }) {
      const config = yield* breniac.get()
      if (!config.transcriptionModel)
        return yield* Effect.fail(
          new UpstreamError({ message: "Breniac: transcriptionModel não configurado", service: "breniac" }),
        )

      const separator = config.transcriptionModel.indexOf("/")
      const providerID = config.transcriptionModel.slice(0, separator)
      const modelID = config.transcriptionModel.slice(separator + 1)

      const providerInfo = yield* provider.getProvider(providerID as any)
      const baseURL = String(providerInfo.options["baseURL"] ?? "").replace(/\/$/, "")
      const apiKey = providerInfo.key

      const bytes = Uint8Array.from(atob(ctx.payload.audio), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append("model", modelID)
      form.append("file", new Blob([bytes], { type: ctx.payload.mimeType }), "turn.webm")

      const res = yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseURL}/audio/transcriptions`, {
            method: "POST",
            headers: {
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              "User-Agent": BROWSER_USER_AGENT,
            },
            body: form,
          }),
        catch: () => new UpstreamError({ message: "Breniac: falha ao chamar o endpoint de transcrição", service: "breniac" }),
      })

      if (!res.ok) {
        const body = yield* Effect.tryPromise({ try: () => res.text(), catch: () => "" }).pipe(Effect.orElseSucceed(() => ""))
        return yield* Effect.fail(
          new UpstreamError({
            message: `Breniac: transcrição falhou (${res.status}): ${body}`,
            service: "breniac",
            status: res.status,
          }),
        )
      }

      const json = yield* Effect.tryPromise({
        try: () => res.json() as Promise<{ text?: string }>,
        catch: () => new UpstreamError({ message: "Breniac: resposta de transcrição inválida", service: "breniac" }),
      })

      return { text: json.text ?? "" }
    })

    return handlers.handle("getConfig", getConfig).handle("setConfig", setConfig).handle("transcribe", transcribe)
  }),
)
