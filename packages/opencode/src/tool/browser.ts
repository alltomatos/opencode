import { Effect, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { RuntimeFlags } from "@/effect/runtime-flags"

const TIMEOUT = 20 * 1000
const PANEL_ID = "main"

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "navigate",
    "back",
    "forward",
    "reload",
    "click",
    "type",
    "key",
    "scroll",
    "screenshot",
    "snapshot",
  ]).annotate({ description: "Which browser action to perform" }),
  url: Schema.optional(Schema.String).annotate({ description: "URL to navigate to (action: navigate)" }),
  ref: Schema.optional(Schema.String).annotate({
    description: "Element ref from a prior snapshot, e.g. ref_3 (action: click)",
  }),
  x: Schema.optional(Schema.Number).annotate({ description: "Viewport x coordinate (action: click, if no ref)" }),
  y: Schema.optional(Schema.Number).annotate({ description: "Viewport y coordinate (action: click, if no ref)" }),
  text: Schema.optional(Schema.String).annotate({ description: "Text to type into the focused element (action: type)" }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key to press, e.g. Enter, Tab, Escape (action: key)",
  }),
  deltaX: Schema.optional(Schema.Number).annotate({ description: "Horizontal scroll amount (action: scroll)" }),
  deltaY: Schema.optional(Schema.Number).annotate({ description: "Vertical scroll amount (action: scroll)" }),
})

const NAVIGATION_ACTIONS = new Set(["navigate", "back", "forward", "reload"])

const StateSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  isLoading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
})

const SnapshotSchema = Schema.Struct({
  outline: Schema.String,
})

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)
    const flags = yield* RuntimeFlags.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const port = flags.browserBridgePort
          const token = flags.browserBridgeToken
          if (Option.isNone(port) || Option.isNone(token)) {
            throw new Error("The browser tool is only available inside the opencode desktop app.")
          }
          const baseUrl = `http://127.0.0.1:${port.value}/panels/${PANEL_ID}`
          const headers = { Authorization: `Bearer ${Redacted.value(token.value)}` }

          if (NAVIGATION_ACTIONS.has(params.action)) {
            yield* ctx.ask({
              permission: "browser",
              patterns: [params.url ?? "*"],
              always: [],
              metadata: { action: params.action, url: params.url },
            })
          }

          const postState = (path: string, body?: unknown) =>
            Effect.gen(function* () {
              const req = yield* HttpClientRequest.post(`${baseUrl}${path}`).pipe(
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.bodyJson(body ?? {}),
              )
              const response = yield* httpOk.execute(req)
              return yield* HttpClientResponse.schemaBodyJson(StateSchema)(response)
            }).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.die(new Error("Browser action timed out")) }),
            )

          const post = (path: string, body: unknown) =>
            Effect.gen(function* () {
              const req = yield* HttpClientRequest.post(`${baseUrl}${path}`).pipe(
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.bodyJson(body),
              )
              yield* httpOk.execute(req)
            }).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.die(new Error("Browser action timed out")) }),
            )

          switch (params.action) {
            case "navigate": {
              if (!params.url) throw new Error("navigate requires a url")
              const state = yield* postState("/navigate", { url: params.url })
              return { output: `Navigated to ${state.url} — "${state.title}"`, title: state.title, metadata: {} }
            }
            case "back": {
              const state = yield* postState("/back")
              return { output: `Went back to ${state.url}`, title: state.title, metadata: {} }
            }
            case "forward": {
              const state = yield* postState("/forward")
              return { output: `Went forward to ${state.url}`, title: state.title, metadata: {} }
            }
            case "reload": {
              const state = yield* postState("/reload")
              return { output: `Reloaded ${state.url}`, title: state.title, metadata: {} }
            }
            case "click": {
              if (!params.ref && (params.x === undefined || params.y === undefined))
                throw new Error("click requires either ref or x/y")
              yield* post("/click", { ref: params.ref, x: params.x, y: params.y })
              return { output: "Clicked", title: "Browser click", metadata: {} }
            }
            case "type": {
              if (!params.text) throw new Error("type requires text")
              yield* post("/type", { text: params.text })
              return { output: `Typed "${params.text}"`, title: "Browser type", metadata: {} }
            }
            case "key": {
              if (!params.key) throw new Error("key requires a key name")
              yield* post("/key", { key: params.key })
              return { output: `Pressed ${params.key}`, title: "Browser key", metadata: {} }
            }
            case "scroll": {
              yield* post("/scroll", { deltaX: params.deltaX ?? 0, deltaY: params.deltaY ?? 0 })
              return { output: "Scrolled", title: "Browser scroll", metadata: {} }
            }
            case "snapshot": {
              const response = yield* httpOk
                .execute(HttpClientRequest.get(`${baseUrl}/snapshot`).pipe(HttpClientRequest.setHeaders(headers)))
                .pipe(
                  Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.die(new Error("Browser action timed out")) }),
                )
              const result = yield* HttpClientResponse.schemaBodyJson(SnapshotSchema)(response)
              return { output: result.outline, title: "Page snapshot", metadata: {} }
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
                title: "Browser screenshot",
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
