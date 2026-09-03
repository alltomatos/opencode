export type SshKeyInfo = {
  path: string
  name: string
}

export type SshServerConfig = {
  id: string
  host: string
  port: number // SSH port on the remote host, default 22
  sshUsername: string
  keyPath: string | null // null = let the ssh client pick (agent/default keys)
  remotePort: number // port the opencode server listens on, remotely
  serverUsername: string // Basic Auth username for the remote opencode server
  serverPassword: string // Basic Auth password for the remote opencode server
  label?: string
}

export type SshServerRuntime =
  | { kind: "starting" }
  | { kind: "ready"; url: string; username: string | null; password: string | null }
  | { kind: "failed"; message: string }
  | { kind: "stopped" }

export type SshServerItem = {
  config: SshServerConfig
  runtime: SshServerRuntime
}

export type SshServersState = {
  servers: SshServerItem[]
  availableKeys: SshKeyInfo[]
}

export type SshServersEvent = { type: "state"; state: SshServersState }

export type SshServersPlatform = {
  getState(): Promise<SshServersState>
  subscribe(cb: (event: SshServersEvent) => void): () => void
  listKeys(): Promise<SshKeyInfo[]>
  addServer(config: Omit<SshServerConfig, "id">): Promise<SshServerConfig>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
}
