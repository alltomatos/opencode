import { Effect, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as Tool from "./tool"
import DESCRIPTION from "./computer.txt"
import { RuntimeFlags } from "@/effect/runtime-flags"

const TIMEOUT = 20 * 1000

export const Parameters = Schema.Struct({
  action: Schema.Literals(["screenshot", "click", "move", "type", "key", "scroll"]).annotate({
    description: "Which computer action to perform",
  }),
  x: Schema.optional(Schema.Number).annotate({ description: "Absolute screen x coordinate (action: click, move)" }),
  y: Schema.optional(Schema.Number).annotate({ description: "Absolute screen y coordinate (action: click, move)" }),
  text: Schema.optional(Schema.String).annotate({ description: "Text to type (action: type)" }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key to press, e.g. Enter, Tab, Escape (action: key)",
  }),
  deltaX: Schema.optional(Schema.Number).annotate({ description: "Horizontal scroll amount (action: scroll)" }),
  deltaY: Schema.optional(Schema.Number).annotate({ description: "Vertical scroll amount (action: scroll)" }),
})

const OkSchema = Schema.Struct({ ok: Schema.Boolean })

export const ComputerTool = Tool.define(
  "computer",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)
    const flags = yield* RuntimeFlags.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const port = flags.computerBridgePort
          const token = flags.computerBridgeToken
          if (Option.isNone(port) || Option.isNone(token)) {
            throw new Error(
              "The computer tool is only available in the opencode desktop app with Computer use enabled in Settings > Experimental.",
            )
          }
          const baseUrl = `http://127.0.0.1:${port.value}`
          const headers = { Authorization: `Bearer ${Redacted.value(token.value)}` }

          yield* ctx.ask({
            permission: "computer",
            patterns: ["*"],
            always: [],
            metadata: { action: params.action },
          })

          const post = (path: string, body: unknown) =>
            Effect.gen(function* () {
              const req = yield* HttpClientRequest.post(`${baseUrl}${path}`).pipe(
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.bodyJson(body),
              )
              const response = yield* httpOk.execute(req)
              return yield* HttpClientResponse.schemaBodyJson(OkSchema)(response)
            }).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.die(new Error("Computer action timed out")) }),
            )

          switch (params.action) {
            case "click": {
              if (params.x === undefined || params.y === undefined) throw new Error("click requires x and y")
              yield* post("/click", { x: params.x, y: params.y })
              return { output: `Clicked at (${params.x}, ${params.y})`, title: "Computer click", metadata: {} }
            }
            case "move": {
              if (params.x === undefined || params.y === undefined) throw new Error("move requires x and y")
              yield* post("/move", { x: params.x, y: params.y })
              return { output: `Moved to (${params.x}, ${params.y})`, title: "Computer move", metadata: {} }
            }
            case "type": {
              if (!params.text) throw new Error("type requires text")
              yield* post("/type", { text: params.text })
              return { output: `Typed "${params.text}"`, title: "Computer type", metadata: {} }
            }
            case "key": {
              if (!params.key) throw new Error("key requires a key name")
              yield* post("/key", { key: params.key })
              return { output: `Pressed ${params.key}`, title: "Computer key", metadata: {} }
            }
            case "scroll": {
              yield* post("/scroll", { deltaX: params.deltaX ?? 0, deltaY: params.deltaY ?? 0 })
              return { output: "Scrolled", title: "Computer scroll", metadata: {} }
            }
            case "screenshot": {
              const response = yield* httpOk
                .execute(HttpClientRequest.get(`${baseUrl}/screenshot`).pipe(HttpClientRequest.setHeaders(headers)))
                .pipe(
                  Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.die(new Error("Screenshot timed out")) }),
                )
              const arrayBuffer = yield* response.arrayBuffer
              const base64 = Buffer.from(arrayBuffer).toString("base64")
              return {
                title: "Computer screenshot",
                output: "Screenshot captured",
                metadata: {},
                attachments: [{ type: "file" as const, mime: "image/png", url: `data:image/png;base64,${base64}` }],
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
