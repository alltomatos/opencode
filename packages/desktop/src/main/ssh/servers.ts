import { randomUUID } from "node:crypto"
import type { SshServerConfig, SshServerItem, SshServerRuntime, SshServersEvent, SshServersState } from "@opencode-ai/app/ssh-tunnel/types"
import { SSH_SERVERS_KEY } from "../store-keys"
import { getStore } from "../store"
import { listSshKeys } from "./keys"

type RunningTunnel = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string
  password: string
}

type SpawnTunnel = (config: SshServerConfig) => Promise<RunningTunnel>

type ControllerLogger = {
  log: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export type SshServersController = ReturnType<typeof createSshServersController>

type SshServersControllerOptions = {
  logger?: ControllerLogger
  readServers?: () => SshServerConfig[]
  writeServers?: (servers: SshServerConfig[]) => void
  listKeys?: () => Promise<{ path: string; name: string }[]>
}

export function createSshServersController(spawnTunnel: SpawnTunnel, options?: SshServersControllerOptions) {
  let state: SshServersState = { servers: [], availableKeys: [] }
  const listeners = new Set<(event: SshServersEvent) => void>()
  const tunnels = new Map<string, RunningTunnel>()
  const startAttempts = new Map<string, number>()
  const logger = options?.logger
  const readServers = options?.readServers ?? readPersistedServers
  const writeServers = options?.writeServers ?? writePersistedServers
  const doListKeys = options?.listKeys ?? listSshKeys

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }
  const setState = (next: Partial<SshServersState>) => {
    state = { ...state, ...next }
    emit()
  }
  const setRuntime = (id: string, runtime: SshServerRuntime) => {
    state = { ...state, servers: state.servers.map((item) => (item.config.id === id ? { ...item, runtime } : item)) }
    emit()
  }

  const nextStartAttempt = (id: string) => {
    const next = (startAttempts.get(id) ?? 0) + 1
    startAttempts.set(id, next)
    return next
  }
  const invalidateStartAttempt = (id: string) => {
    startAttempts.set(id, (startAttempts.get(id) ?? 0) + 1)
  }
  const isCurrentStartAttempt = (id: string, attempt: number) =>
    startAttempts.get(id) === attempt && state.servers.some((item) => item.config.id === id)

  const stopTunnelInternal = (id: string) => {
    const existing = tunnels.get(id)
    if (!existing) return
    tunnels.delete(id)
    try {
      existing.listener.stop()
    } catch {
      // ignore stop errors
    }
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)
    if (!item) return
    const attempt = nextStartAttempt(id)
    stopTunnelInternal(id)
    if (!isCurrentStartAttempt(id, attempt)) return
    setRuntime(id, { kind: "starting" })
    logger?.log("ssh tunnel starting", { id, host: item.config.host })
    try {
      const tunnel = await spawnTunnel(item.config)
      if (!isCurrentStartAttempt(id, attempt)) {
        try {
          tunnel.listener.stop()
        } catch {
          // ignore stop errors for stale tunnels
        }
        return
      }
      tunnels.set(id, tunnel)
      setRuntime(id, { kind: "ready", url: tunnel.url, username: tunnel.username, password: tunnel.password })
      tunnel.listener.onExit((code, signal) => {
        if (tunnels.get(id) !== tunnel) return
        tunnels.delete(id)
        setRuntime(id, { kind: "failed", message: `ssh saiu (code=${code ?? "null"}, signal=${signal ?? "null"})` })
        logger?.error("ssh tunnel exited", { id, host: item.config.host, code, signal })
      })
      logger?.log("ssh tunnel ready", { id, host: item.config.host, url: tunnel.url })
    } catch (error) {
      if (!isCurrentStartAttempt(id, attempt)) return
      const message = error instanceof Error ? error.message : String(error)
      setRuntime(id, { kind: "failed", message })
      logger?.error("ssh tunnel failed to start", { id, host: item.config.host, message })
    }
  }

  const listKeys = async () => {
    const keys = await doListKeys()
    setState({ availableKeys: keys })
    return keys
  }

  return {
    getState() {
      return state
    },
    subscribe(listener: (event: SshServersEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async initialize() {
      const persisted = readServers()
      setState({ servers: persisted.map((config) => ({ config, runtime: { kind: "stopped" } })) })
      void listKeys()
      for (const item of state.servers) void startServer(item.config.id)
    },
    listKeys,
    async addServer(config: Omit<SshServerConfig, "id">): Promise<SshServerConfig> {
      const full: SshServerConfig = { ...config, id: `ssh:${randomUUID()}` }
      const persisted = [...readServers(), full]
      writeServers(persisted)
      setState({ servers: [...state.servers, { config: full, runtime: { kind: "starting" } }] })
      void startServer(full.id)
      return full
    },
    async removeServer(id: string) {
      invalidateStartAttempt(id)
      stopTunnelInternal(id)
      writeServers(readServers().filter((item) => item.id !== id))
      setState({ servers: state.servers.filter((item) => item.config.id !== id) })
    },
    startServer,
    stopAll() {
      for (const item of state.servers) invalidateStartAttempt(item.config.id)
      for (const tunnel of tunnels.values()) {
        try {
          tunnel.listener.stop()
        } catch {
          // ignore
        }
      }
      tunnels.clear()
    },
  }
}

function readPersistedServers(): SshServerConfig[] {
  const store = getStore()
  const existing = store.get(SSH_SERVERS_KEY)
  if (existing && typeof existing === "object") {
    const record = existing as { servers?: unknown }
    const list = Array.isArray(record.servers) ? record.servers : []
    return list.flatMap(normalizePersistedServer)
  }
  return []
}

function writePersistedServers(servers: SshServerConfig[]) {
  getStore().set(SSH_SERVERS_KEY, { servers })
}

function normalizePersistedServer(value: unknown): SshServerConfig[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const host = typeof record.host === "string" && record.host.length > 0 ? record.host : null
  if (!host) return []
  return [
    {
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : `ssh:${randomUUID()}`,
      host,
      port: typeof record.port === "number" ? record.port : 22,
      sshUsername: typeof record.sshUsername === "string" ? record.sshUsername : "root",
      keyPath: typeof record.keyPath === "string" ? record.keyPath : null,
      remotePort: typeof record.remotePort === "number" ? record.remotePort : 4096,
      serverUsername: typeof record.serverUsername === "string" ? record.serverUsername : "opencode",
      serverPassword: typeof record.serverPassword === "string" ? record.serverPassword : "",
      label: typeof record.label === "string" ? record.label : undefined,
    },
  ]
}

export type { SshServerConfig, SshServerItem, SshServerRuntime, SshServersEvent, SshServersState }
