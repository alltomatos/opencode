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
  certPath: string | null // null = let the ssh client pick (agent/default certs)
  sshPassword: string | null // null = use key-based auth, otherwise use password auth
  remotePort: number // port the opencode server listens on, remotely
  serverUsername: string // Basic Auth username for the remote opencode server
  serverPassword: string // Basic Auth password for the remote opencode server
  label?: string
  autoSetup?: boolean // auto-install/update opencode on the remote server
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

export type SshSetupStep = "test_ssh" | "check_install" | "start_service" | "tunnel"

export type SshStepStatus = "pending" | "running" | "done" | "failed"

export type SshLogEntry = {
  id: string
  timestamp: number
  level: "info" | "stdout" | "stderr" | "success" | "error"
  message: string
}

export type SshConnectionProgress = {
  serverId: string
  host: string
  active: boolean
  currentStep: SshSetupStep
  steps: Record<SshSetupStep, { status: SshStepStatus; label?: string; error?: string }>
  logs: SshLogEntry[]
  completed: boolean
  success: boolean
  error?: string
}

export type SshServersState = {
  servers: SshServerItem[]
  availableKeys: SshKeyInfo[]
  progress?: SshConnectionProgress | null
}

export type SshServersEvent = { type: "state"; state: SshServersState }

export type SshServersPlatform = {
  getState(): Promise<SshServersState>
  subscribe(cb: (event: SshServersEvent) => void): () => void
  listKeys(): Promise<SshKeyInfo[]>
  addServer(config: Omit<SshServerConfig, "id">): Promise<SshServerConfig>
  renameServer?(id: string, label?: string): Promise<void>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
  updateServer?(id: string): Promise<void>
  clearProgress?(): Promise<void>
  syncCredentials?(
    id: string,
    credentials: Array<{ integrationID: string; label?: string; value: unknown }>,
  ): Promise<{ synced: number }>
}
