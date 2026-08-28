import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Server } from "../../src/server/server"
import { ExternalAgentSessionsPaths } from "../../src/server/routes/instance/httpapi/groups/external-agent"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { ExternalAgent } from "../../src/external-agent"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config, Effect, Layer, Queue } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

// Shares the SAME ExternalAgent.Service instance that backs the served HTTP+WS routes
// below (both resolve the identical module-level ExternalAgent.node within one Layer
// build), so a session spawned directly against the service is visible through the
// real HTTP surface — same trick MCP.Service tests use via testEffect(LayerNode.compile(...)).
const externalAgentLive = LayerNode.compile(ExternalAgent.node)

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)

const effectIt = testEffect(
  Layer.mergeAll(
    testStateLayer,
    Socket.layerWebSocketConstructorGlobal,
    externalAgentLive,
    servedRoutes.pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
)

function app() {
  return Server.Default().app
}

function serverUrl() {
  return HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))
}

// A worker that echoes whatever it receives on stdin back to stdout and never exits on
// its own — enough to prove the WS stream is live, without depending on any real CLI agent.
const echoWorker = () => ({
  command: process.execPath,
  args: ["-e", "process.stdin.on('data', (d) => process.stdout.write(d))"],
  cwd: process.cwd(),
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("external agent HttpApi bridge", () => {
  ;(process.platform === "win32" ? effectIt.live.skip : effectIt.live)(
    "lists active external agent sessions",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir({ config: { formatter: false, lsp: false } })),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const headers = { "x-opencode-directory": tmp.path }
        const base = (yield* serverUrl()).replace(/\/$/, "")

        const empty = yield* Effect.promise(() => fetch(`${base}${ExternalAgentSessionsPaths.list}`, { headers }))
        expect(empty.status).toBe(200)

        const agent = yield* ExternalAgent.Service
        const handle = yield* agent.spawn(echoWorker())

        const listed = yield* Effect.promise(() => fetch(`${base}${ExternalAgentSessionsPaths.list}`, { headers }))
        expect(listed.status).toBe(200)
        const sessions = (yield* Effect.promise(() => listed.json())) as Array<{ handle: string; command: string }>
        expect(sessions.some((session) => session.handle === handle)).toBe(true)

        yield* agent.kill(handle)
      }),
    15_000,
  )

  test("returns typed errors for connect token failures", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const missingHandle = "ext_does_not_exist"

    const forbidden = await app().request(ExternalAgentSessionsPaths.connectToken.replace(":handle", missingHandle), {
      method: "POST",
      headers,
    })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      _tag: "ExternalAgentForbiddenError",
      message: "Invalid connect token request",
    })

    const missing = await app().request(ExternalAgentSessionsPaths.connectToken.replace(":handle", missingHandle), {
      method: "POST",
      headers: { ...headers, "x-opencode-ticket": "1" },
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      _tag: "ExternalAgentSessionNotFoundError",
      handle: missingHandle,
      message: `External agent session not found: ${missingHandle}`,
    })
  })

  ;(process.platform === "win32" ? effectIt.live.skip : effectIt.live)(
    "streams live output over the ticket-authenticated WebSocket connection",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
        const agent = yield* ExternalAgent.Service
        const handle = yield* agent.spawn(echoWorker())

        const base = (yield* serverUrl()).replace(/\/$/, "")
        const tokenResponse = yield* Effect.promise(() =>
          fetch(`${base}${ExternalAgentSessionsPaths.connectToken.replace(":handle", handle)}`, {
            method: "POST",
            headers: { "x-opencode-directory": dir, "x-opencode-ticket": "1" },
          }),
        )
        expect(tokenResponse.status).toBe(200)
        const token = (yield* Effect.promise(() => tokenResponse.json())) as { ticket: string }

        const url = `${base.replace(/^http/, "ws")}${ExternalAgentSessionsPaths.connect.replace(":handle", handle)}?ticket=${token.ticket}&directory=${encodeURIComponent(dir)}`
        const socket = yield* Socket.makeWebSocket(url, { closeCodeIsError: () => false })
        const messages = yield* Queue.unbounded<string>()
        yield* socket
          .runRaw((message) =>
            Queue.offer(messages, typeof message === "string" ? message : new TextDecoder().decode(message)),
          )
          .pipe(Effect.catch(() => Effect.void))
          .pipe(Effect.forkScoped)
        const write = yield* socket.writer

        const takeUntil = (expected: string, seen = ""): Effect.Effect<string, unknown> =>
          Effect.gen(function* () {
            const next = seen + (yield* Queue.take(messages).pipe(Effect.timeout("5 seconds")))
            if (next.includes(expected)) return next
            return yield* takeUntil(expected, next)
          })

        yield* write("hello-external-agent\n")
        expect(yield* takeUntil("hello-external-agent")).toContain("hello-external-agent")
        yield* write(new Socket.CloseEvent(1000, "done")).pipe(Effect.catch(() => Effect.void))

        yield* agent.kill(handle)
      }),
    15_000,
  )
})
