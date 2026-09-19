import { expect, test } from "bun:test"
import { createSshServersController } from "./servers"
import type { SshServerConfig } from "@opencode-ai/app/ssh-tunnel/types"

function baseConfig(overrides: Partial<Omit<SshServerConfig, "id">> = {}): Omit<SshServerConfig, "id"> {
  return {
    host: "example.test",
    port: 22,
    sshUsername: "root",
    keyPath: null,
    remotePort: 4096,
    serverUsername: "opencode",
    serverPassword: "secret",
    ...overrides,
  }
}

function makeTestController(spawnTunnel: Parameters<typeof createSshServersController>[0]) {
  let persisted: SshServerConfig[] = []
  const controller = createSshServersController(spawnTunnel, {
    readServers: () => persisted,
    writeServers: (servers) => {
      persisted = servers
    },
    listKeys: async () => [],
  })
  return { controller, getPersisted: () => persisted }
}

function waitForRuntime(controller: ReturnType<typeof createSshServersController>, id: string, kind: string) {
  return new Promise<void>((resolve) => {
    const check = () => {
      const item = controller.getState().servers.find((x) => x.config.id === id)
      if (item?.runtime.kind === kind) {
        resolve()
        return
      }
      const off = controller.subscribe(() => {
        const current = controller.getState().servers.find((x) => x.config.id === id)
        if (current?.runtime.kind === kind) {
          off()
          resolve()
        }
      })
    }
    check()
  })
}

test("addServer persists the config and starts a tunnel", async () => {
  const { controller, getPersisted } = makeTestController(async (config) => ({
    listener: { stop: () => {}, onExit: () => {} },
    url: `http://127.0.0.1:1234`,
    username: config.serverUsername,
    password: config.serverPassword,
  }))

  const config = await controller.addServer(baseConfig())
  await waitForRuntime(controller, config.id, "ready")

  expect(getPersisted()).toEqual([config])
  const item = controller.getState().servers.find((x) => x.config.id === config.id)
  expect(item?.runtime).toEqual({ kind: "ready", url: "http://127.0.0.1:1234", username: "opencode", password: "secret" })
})

test("a failing spawn leaves the server in a failed state with the error message", async () => {
  const { controller } = makeTestController(async () => {
    throw new Error("ssh: connection refused")
  })

  const config = await controller.addServer(baseConfig())
  await waitForRuntime(controller, config.id, "failed")

  const item = controller.getState().servers.find((x) => x.config.id === config.id)
  expect(item?.runtime).toEqual({ kind: "failed", message: "ssh: connection refused" })
})

test("removeServer stops the tunnel and drops the persisted config", async () => {
  let stopped = false
  const { controller, getPersisted } = makeTestController(async (config) => ({
    listener: { stop: () => (stopped = true), onExit: () => {} },
    url: "http://127.0.0.1:1234",
    username: config.serverUsername,
    password: config.serverPassword,
  }))

  const config = await controller.addServer(baseConfig())
  await waitForRuntime(controller, config.id, "ready")

  await controller.removeServer(config.id)

  expect(stopped).toBe(true)
  expect(getPersisted()).toEqual([])
  expect(controller.getState().servers).toEqual([])
})

test("initialize starts every persisted server", async () => {
  const started: string[] = []
  const persisted: SshServerConfig[] = [
    { ...baseConfig({ host: "one.test" }), id: "ssh:one" },
    { ...baseConfig({ host: "two.test" }), id: "ssh:two" },
  ]
  const controller = createSshServersController(
    async (config) => {
      started.push(config.host)
      return {
        listener: { stop: () => {}, onExit: () => {} },
        url: "http://127.0.0.1:1234",
        username: config.serverUsername,
        password: config.serverPassword,
      }
    },
    { readServers: () => persisted, writeServers: () => {}, listKeys: async () => [] },
  )

  await controller.initialize()
  await waitForRuntime(controller, "ssh:one", "ready")
  await waitForRuntime(controller, "ssh:two", "ready")

  expect(started.sort()).toEqual(["one.test", "two.test"])
})

test("syncCredentials sends credentials to remote endpoint", async () => {
  const { controller } = makeTestController(async (config) => ({
    listener: { stop: () => {}, onExit: () => {} },
    url: "http://127.0.0.1:4096",
    username: config.serverUsername,
    password: config.serverPassword,
  }))

  const config = await controller.addServer(baseConfig())
  await waitForRuntime(controller, config.id, "ready")

  const originalFetch = globalThis.fetch
  let calledUrl = ""
  let calledHeaders: any = {}
  let calledBody = ""

  globalThis.fetch = (async (url: string, init?: any) => {
    calledUrl = url
    calledHeaders = init?.headers
    calledBody = init?.body
    return new Response(JSON.stringify({ id: "cred_123" }), { status: 200 })
  }) as any

  try {
    const res = await controller.syncCredentials(config.id, [
      { integrationID: "openai", label: "Default", value: { type: "key", key: "sk-test" } },
    ])
    expect(res.synced).toBe(1)
    expect(calledUrl).toBe("http://127.0.0.1:4096/api/credential")
    expect(calledHeaders["Authorization"]).toBe(
      "Basic " + Buffer.from(`${config.serverUsername}:${config.serverPassword}`).toString("base64"),
    )
    const parsed = JSON.parse(calledBody)
    expect(parsed.integrationID).toBe("openai")
    expect(parsed.value.key).toBe("sk-test")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("startServer populates progress state with sequential steps and logs", async () => {
  const { controller } = makeTestController(async (config, opts) => {
    opts?.onStep?.("test_ssh", "running")
    opts?.onLog?.("info", "Testing SSH...")
    opts?.onStep?.("test_ssh", "done")

    opts?.onStep?.("check_install", "running")
    opts?.onLog?.("success", "OpenCode installed")
    opts?.onStep?.("check_install", "done")

    opts?.onStep?.("start_service", "running")
    opts?.onStep?.("start_service", "done")

    opts?.onStep?.("tunnel", "running")
    opts?.onStep?.("tunnel", "done")

    return {
      listener: { stop: () => {}, onExit: () => {} },
      url: "http://127.0.0.1:4096",
      username: config.serverUsername,
      password: config.serverPassword,
    }
  })

  const config = await controller.addServer(baseConfig())
  await waitForRuntime(controller, config.id, "ready")

  const progress = controller.getState().progress
  expect(progress).toBeDefined()
  expect(progress?.serverId).toBe(config.id)
  expect(progress?.completed).toBe(true)
  expect(progress?.success).toBe(true)
  expect(progress?.steps.test_ssh.status).toBe("done")
  expect(progress?.steps.check_install.status).toBe("done")
  expect(progress?.steps.start_service.status).toBe("done")
  expect(progress?.steps.tunnel.status).toBe("done")
  expect(progress?.logs.length).toBeGreaterThanOrEqual(2)
})
