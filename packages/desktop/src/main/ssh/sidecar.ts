import { spawn } from "node:child_process"
import { createServer } from "node:net"
import type { SshServerConfig } from "@opencode-ai/app/ssh-tunnel/types"
import { pollWslHealth } from "../wsl/startup"

export type SshTunnel = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string
  password: string
}

type RemoteCommandResult = {
  success: boolean
  output: string
  error?: string
}

async function runRemoteCommand(
  config: SshServerConfig,
  command: string,
  timeoutMs = 30_000,
): Promise<RemoteCommandResult> {
  const args = ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes"]

  if (config.keyPath) args.push("-i", config.keyPath)
  if (config.certPath) args.push("-o", "CertificateFile=" + config.certPath)
  if (config.sshPassword) {
    args.push("-o", "PasswordAuthentication=yes")
    args.push("-o", "BatchMode=no")
  }

  args.push(`${config.sshUsername}@${config.host}`)
  args.push(command)

  let cmd = "ssh"
  const spawnOpts: Parameters<typeof spawn>[2] = { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: timeoutMs }

  if (config.sshPassword) {
    cmd = "sshpass"
    spawnOpts.env = { ...process.env, SSHPASS: config.sshPassword }
    args.unshift("-e")
    args.unshift("ssh")
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, spawnOpts)
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()))

    child.on("error", () =>
      resolve({
        success: false,
        output: "",
        error: `Erro ao executar comando remoto: ${stderr}`,
      }),
    )
    child.on("exit", (code: number | null) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() })
      } else {
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() })
      }
    })
  })
}

async function ensureOpencodeOnRemote(
  config: SshServerConfig,
  onLine?: (message: string) => void,
): Promise<{ installed: boolean; updated: boolean; version?: string }> {
  const checkResult = await runRemoteCommand(config, "opencode --version 2>/dev/null || echo 'not-installed'")

  if (!checkResult.success || checkResult.output === "not-installed" || checkResult.error?.includes("not-installed")) {
    onLine?.("opencode não encontrado no servidor remoto, instalando...")

    const installResult = await runRemoteCommand(
      config,
      "mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global && npm install -g @opencode-ai/server && hash -r && opencode --version",
    )

    if (installResult.success) {
      const version = installResult.output.split("\n").pop()?.trim()
      onLine?.(`opencode instalado com sucesso (versão: ${version})`)
      return { installed: true, updated: true, version }
    } else {
      onLine?.(`Falha ao instalar opencode: ${installResult.error || installResult.output}`)
      return { installed: false, updated: false }
    }
  }

  const version = checkResult.output.split("\n").pop()?.trim()
  onLine?.(`opencode já instalado (versão: ${version})`)

  const pullResult = await runRemoteCommand(config, "npm install -g @opencode-ai/server@latest 2>&1")

  if (pullResult.success || !pullResult.output?.includes("EESM") || pullResult.output?.includes("already")) {
    const newVersionResult = await runRemoteCommand(config, "opencode --version 2>/dev/null || echo 'unknown'")
    const newVersion = newVersionResult.success ? newVersionResult.output.trim() : version
    if (newVersion !== version) {
      onLine?.(`opencode atualizado para a versão ${newVersion}`)
      return { installed: true, updated: true, version: newVersion }
    }
  }

  return { installed: true, updated: false, version }
}

async function checkOpencodeHealth(url: string, username: string, password: string): Promise<boolean> {
  const auth = Buffer.from(`${username}:${password}`).toString("base64")
  for (const path of ["/api/health", "/global/health"]) {
    try {
      const response = await fetch(new URL(path, url), {
        headers: { authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return true
    } catch {
      // try the next health path
    }
  }
  return false
}

function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to allocate a local port"))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function forwardLines(stream: NodeJS.ReadableStream, onLine: (text: string) => void) {
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    pending += chunk
    const lines = pending.split(/\r?\n/g)
    pending = lines.pop() ?? ""
    lines.forEach((text) => text.trim() && onLine(text))
  })
}

// Spawns `ssh -N -L <localPort>:127.0.0.1:<remotePort> user@host` as a
// long-lived tunnel, then confirms the opencode server on the other end is
// actually reachable through it before declaring the tunnel ready — mirrors
// spawnWslSidecar's startup race (health check vs. process exit vs. timeout).
export async function spawnSshTunnel(
  config: SshServerConfig,
  opts: { onLine?: (line: { stream: "stdout" | "stderr"; text: string }) => void; healthTimeoutMs?: number } = {},
): Promise<SshTunnel> {
  const localPort = await allocatePort()
  const args = [
    "-N",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-p",
    String(config.port),
    "-L",
    `${localPort}:127.0.0.1:${config.remotePort}`,
    `${config.sshUsername}@${config.host}`,
  ]
  if (config.keyPath) args.push("-i", config.keyPath)
  if (config.certPath) args.push("-o", "CertificateFile=" + config.certPath)
  if (config.sshPassword) {
    args.push("-o", "PasswordAuthentication=yes")
    args.push("-o", "BatchMode=no")
  }

  const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  const recentOutput: string[] = []
  const emit = (stream: "stdout" | "stderr", text: string) => {
    recentOutput.push(`[${stream}] ${text}`)
    if (recentOutput.length > 12) recentOutput.shift()
    opts.onLine?.({ stream, text })
  }
  forwardLines(child.stdout, (text) => emit("stdout", text))
  forwardLines(child.stderr, (text) => emit("stderr", text))

  const exit = new Promise<never>((_, reject) => {
    child.once("error", (error) =>
      reject(
        error.message.includes("ENOENT")
          ? new Error("O comando `ssh` não foi encontrado — instale um cliente OpenSSH nesta máquina.")
          : error,
      ),
    )
    child.once("exit", (code, signal) => reject(new Error(sshFailure(code, signal, recentOutput))))
  })

  const url = `http://127.0.0.1:${localPort}`
  const startup = new AbortController()
  const health = pollWslHealth(
    () => checkOpencodeHealth(url, config.serverUsername, config.serverPassword),
    startup.signal,
  )
  const timeoutMs = opts.healthTimeoutMs ?? 20_000
  let timeout: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>(
    (_, reject) =>
      (timeout = setTimeout(
        () => reject(new Error(`Túnel SSH abriu mas o opencode não respondeu em ${config.host} em ${timeoutMs}ms.`)),
        timeoutMs,
      )),
  )

  await Promise.race([health, exit, timedOut])
    .catch((error) => {
      child.kill()
      throw error
    })
    .finally(() => {
      clearTimeout(timeout)
      startup.abort()
    })

  if (config.autoSetup) {
    opts.onLine?.({ stream: "stdout", text: "executando setup automático do opencode..." })
    try {
      await ensureOpencodeOnRemote(
        config,
        (msg) => opts.onLine?.({ stream: "stdout", text: msg }),
      )
    } catch (e) {
      opts.onLine?.({ stream: "stderr", text: `setup automático falhou: ${String(e)}` })
    }
  }

  return {
    listener: {
      stop: () => child.kill(),
      onExit: (cb) => child.once("exit", cb),
    },
    url,
    username: config.serverUsername,
    password: config.serverPassword,
  }
}

function sshFailure(code: number | null, signal: NodeJS.Signals | null, recentOutput: string[]) {
  const suffix = recentOutput.length ? `\n${recentOutput.join("\n")}` : ""
  return `ssh saiu antes do túnel ficar pronto (code=${code ?? "null"}, signal=${signal ?? "null"})${suffix}`
}
