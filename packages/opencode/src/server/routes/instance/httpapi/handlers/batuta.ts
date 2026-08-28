import { Batuta } from "@/batuta"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Git } from "@/git"
import * as InstanceState from "@/effect/instance-state"
import type { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { Effect, Scope } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { BatutaActivityNotFoundError, BatutaWorkerNotFoundError } from "../errors"

export const batutaHandlers = HttpApiBuilder.group(InstanceHttpApi, "batuta", (handlers) =>
  Effect.gen(function* () {
    const batuta = yield* Batuta.Service
    const promptSvc = yield* SessionPrompt.Service
    const git = yield* Git.Service
    const scope = yield* Scope.Scope

    const branches = Effect.fn("BatutaHttpApi.branches")(function* () {
      const ctx = yield* InstanceState.context
      const directory = ctx.directory
      const [current, list] = yield* Effect.all(
        [
          git.branch(directory),
          git
            .run(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd: directory })
            .pipe(Effect.map((result) => result.text().split(/\r?\n/).map((line) => line.trim()).filter(Boolean))),
        ],
        { concurrency: "unbounded" },
      )
      return { current, branches: list }
    })

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

    // Fires the session's first message in the background — the HTTP call
    // that created the session shouldn't block on a full agent turn.
    const fireInitialPrompt = Effect.fn("BatutaHttpApi.fireInitialPrompt")(function* (input: {
      sessionID: string
      instructions: string
    }) {
      yield* promptSvc
        .prompt({
          sessionID: SessionID.make(input.sessionID),
          parts: [{ type: "text", text: input.instructions }],
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Batuta: failed to send initial prompt", { sessionID: input.sessionID, cause }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
    })

    const start = Effect.fn("BatutaHttpApi.start")(function* (ctx: { params: { id: string } }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const host = request.headers.host
      // External orchestrators spawn on the same machine as the server (never
      // the desktop client) and need a URL to call back into for delegation —
      // the Host header of the request that started them is the right one.
      const serverURL = host ? `${request.headers["x-forwarded-proto"] ? "https" : "http"}://${host}` : undefined
      const result = yield* batuta.start(ctx.params.id, { serverURL }).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      // start() returns instructions:"" as a sentinel for an external
      // orchestrator — it was already sent its prompt directly via PTY, not
      // through SessionPrompt (there's no session to prompt against).
      if (result.instructions) {
        yield* fireInitialPrompt({ sessionID: result.sessionID, instructions: result.instructions })
      }
      return { sessionID: result.sessionID }
    })

    const delegate = Effect.fn("BatutaHttpApi.delegate")(function* (ctx: {
      params: { id: string }
      payload: { label: string; prompt: string }
    }) {
      const result = yield* batuta.delegate(ctx.params.id, ctx.payload.label, ctx.payload.prompt).pipe(
        Effect.catchTags({
          "Batuta.NotFoundError": (error) =>
            Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
          "Batuta.WorkerNotFoundError": (error) =>
            Effect.fail(
              new BatutaWorkerNotFoundError({
                id: error.id,
                label: error.label,
                message: `Worker not found: ${error.label}`,
              }),
            ),
        }),
      )
      if (result.kind === "external") return { output: result.output }
      const message = yield* promptSvc
        .prompt({
          sessionID: result.sessionID,
          parts: [{ type: "text", text: result.prompt }],
        })
        .pipe(Effect.orDie)
      const output = message.parts.findLast((item) => item.type === "text")?.text ?? ""
      return { output }
    })

    const runningWorkers = Effect.fn("BatutaHttpApi.runningWorkers")(function* (ctx: { params: { id: string } }) {
      return yield* batuta.runningWorkers(ctx.params.id)
    })

    const sync = Effect.fn("BatutaHttpApi.sync")(function* (ctx: { params: { id: string } }) {
      const result = yield* batuta.checkHandoff(ctx.params.id).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      return { activity: result.activity, handoff: result.handoff }
    })

    const dispatch = Effect.fn("BatutaHttpApi.dispatch")(function* (ctx: { params: { id: string } }) {
      const result = yield* batuta.dispatch(ctx.params.id).pipe(
        Effect.catchTags({
          "Batuta.NotFoundError": (error) =>
            Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
          "Batuta.HandoffNotFoundError": (error) =>
            Effect.fail(
              new BatutaActivityNotFoundError({ id: error.id, message: `Handoff not ready yet: ${error.id}` }),
            ),
        }),
      )
      yield* fireInitialPrompt(result)
      return { sessionID: result.sessionID }
    })

    const getPipelineDefinition = Effect.fn("BatutaHttpApi.getPipelineDefinition")(function* (ctx: {
      params: { id: string }
    }) {
      const content = yield* batuta.readPipelineDefinition(ctx.params.id).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      return { content }
    })

    const setPipelineDefinition = Effect.fn("BatutaHttpApi.setPipelineDefinition")(function* (ctx: {
      params: { id: string }
      payload: { content: string }
    }) {
      yield* batuta.writePipelineDefinition(ctx.params.id, ctx.payload.content).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      return { content: ctx.payload.content }
    })

    const startPipelineChat = Effect.fn("BatutaHttpApi.startPipelineChat")(function* (ctx: {
      params: { id: string }
    }) {
      const result = yield* batuta.startPipelineChat(ctx.params.id).pipe(
        Effect.catchTag("Batuta.NotFoundError", (error) =>
          Effect.fail(new BatutaActivityNotFoundError({ id: error.id, message: `Activity not found: ${error.id}` })),
        ),
      )
      yield* fireInitialPrompt({ sessionID: result.sessionID, instructions: result.instructions })
      return { sessionID: result.sessionID }
    })

    return handlers
      .handle("list", list)
      .handle("add", add)
      .handle("remove", remove)
      .handle("start", start)
      .handle("delegate", delegate)
      .handle("runningWorkers", runningWorkers)
      .handle("sync", sync)
      .handle("dispatch", dispatch)
      .handle("branches", branches)
      .handle("getPipelineDefinition", getPipelineDefinition)
      .handle("setPipelineDefinition", setPipelineDefinition)
      .handle("startPipelineChat", startPipelineChat)
  }),
)
