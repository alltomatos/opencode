import { spawn } from "node:child_process"
import { createServer } from "node:net"
import type { SshServerConfig, SshSetupStep, SshStepStatus } from "@opencode-ai/app/ssh-tunnel/types"
import { pollWslHealth } from "../wsl/startup"

export type SshTunnel = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string
  password: string
}

export type SshTunnelOpts = {
  onLine?: (line: { stream: "stdout" | "stderr"; text: string }) => void
  onStep?: (step: SshSetupStep, status: SshStepStatus, error?: string) => void
  onLog?: (level: "info" | "stdout" | "stderr" | "success" | "error", message: string) => void
  healthTimeoutMs?: number
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
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void,
): Promise<RemoteCommandResult> {
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "BatchMode=" + (config.sshPassword ? "no" : "yes"),
    "-p",
    String(config.port),
  ]

  if (config.keyPath) args.push("-i", config.keyPath)
  if (config.certPath) args.push("-o", "CertificateFile=" + config.certPath)
  if (config.sshPassword) {
    args.push("-o", "PasswordAuthentication=yes")
  }

  args.push(`${config.sshUsername}@${config.host}`)
  args.push(command)

  let cmd = "ssh"
  const spawnOpts: Parameters<typeof spawn>[2] = {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: timeoutMs,
  }

  if (config.sshPassword) {
    cmd = "sshpass"
    spawnOpts.env = { ...process.env, SSHPASS: config.sshPassword }
    args.unshift("-e")
    args.unshift("ssh")
  }

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, spawnOpts)
    } catch (err) {
      resolve({
        success: false,
        output: "",
        error: `Não foi possível iniciar o cliente SSH: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      onOutput?.(text, "stdout")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      onOutput?.(text, "stderr")
    })

    child.on("error", (err) =>
      resolve({
        success: false,
        output: "",
        error: `Erro ao executar comando SSH: ${err.message || stderr}`,
      }),
    )
    child.on("exit", (code: number | null) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() })
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Comando remoto saiu com código ${code}`
        resolve({ success: false, output: stdout.trim(), error: errorMsg })
      }
    })
  })
}

async function checkOpencodeHealth(url: string, username: string, password: string): Promise<boolean> {
  const auth = Buffer.from(`${username}:${password}`).toString("base64")
  for (const path of ["/global/health", "/api/health"]) {
    try {
      const response = await fetch(new URL(path, url), {
        headers: { authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(2500),
      })
      if (response.ok || response.status === 401) return true
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pipeline sequencial (em fila, não paralelizado) para conectar e iniciar servidor SSH:
 * Etapa 1: Testar conectividade e autenticação SSH
 * Etapa 2: Verificar e instalar opencode no servidor remoto
 * Etapa 3: Iniciar e verificar serviço opencode no servidor remoto
 * Etapa 4: Estabelecer túnel SSH local e validar comunicação
 */
export async function spawnSshTunnel(config: SshServerConfig, opts: SshTunnelOpts = {}): Promise<SshTunnel> {
  const log = (level: "info" | "stdout" | "stderr" | "success" | "error", message: string) => {
    opts.onLog?.(level, message)
    if (level === "stdout" || level === "stderr") {
      opts.onLine?.({ stream: level, text: message })
    }
  }

  const setStep = (step: SshSetupStep, status: SshStepStatus, error?: string) => {
    opts.onStep?.(step, status, error)
  }

  // ==========================================
  // ETAPA 1: Teste de Conexão e Autenticação SSH
  // ==========================================
  setStep("test_ssh", "running")
  log("info", `[1/4] Conectando via SSH em ${config.sshUsername}@${config.host}:${config.port}...`)

  const sshTestResult = await runRemoteCommand(config, "echo '__OPENCODE_SSH_OK__'", 20_000)
  if (!sshTestResult.success || !sshTestResult.output.includes("__OPENCODE_SSH_OK__")) {
    const errorMsg = sshTestResult.error || "Falha na autenticação ou timeout de conexão SSH."
    setStep("test_ssh", "failed", errorMsg)
    log("error", `Falha na conexão SSH: ${errorMsg}`)
    throw new Error(`Falha na conexão SSH (${config.host}): ${errorMsg}`)
  }

  setStep("test_ssh", "done")
  log("success", `[1/4] Conexão SSH autenticada com sucesso em ${config.host}.`)

  // Auto-detectar senha do OpenCode na VPS se o usuário não forneceu
  if (!config.serverPassword) {
    const detectPassCmd =
      `grep -oP '(?<=OPENCODE_SERVER_PASSWORD=)[^\\s]+' /etc/systemd/system/opencode.service 2>/dev/null || ` +
      `(pgrep -f "opencode.*serve" >/dev/null && tr '\\0' '\\n' < /proc/$(pgrep -f "opencode.*serve" | head -n1)/environ 2>/dev/null | grep '^OPENCODE_SERVER_PASSWORD=' | cut -d= -f2-) || echo ""`
    const passResult = await runRemoteCommand(config, detectPassCmd, 5000)
    const detectedPassword = passResult.output.trim()
    if (detectedPassword) {
      config.serverPassword = detectedPassword
      log("info", "Senha do servidor OpenCode detectada automaticamente na VPS.")
    }
  }

  // ==========================================
  // ETAPA 2: Verificação e Instalação do OpenCode
  // ==========================================
  setStep("check_install", "running")
  log("info", `[2/4] Verificando instalação do OpenCode no servidor remoto...`)

  const pathPrefix = 'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"'
  const checkCmd = `${pathPrefix}; opencode --version 2>/dev/null || which opencode 2>/dev/null || echo "NOT_INSTALLED"`
  const checkResult = await runRemoteCommand(config, checkCmd, 20_000)

  let installedVersion: string | null = null
  if (checkResult.success && checkResult.output && !checkResult.output.includes("NOT_INSTALLED")) {
    installedVersion = checkResult.output.split("\n").pop()?.trim() || "detectado"
    log("success", `[2/4] OpenCode já está instalado no servidor (versão: ${installedVersion}).`)
    setStep("check_install", "done")
  } else {
    // Se o serviço systemd opencode já existe, está instalado
    const checkService = await runRemoteCommand(config, "systemctl status opencode 2>/dev/null || echo 'NO_SERVICE'", 5000)
    if (checkService.success && !checkService.output.includes("NO_SERVICE")) {
      log("success", `[2/4] Serviço OpenCode detectado via systemd na VPS.`)
      setStep("check_install", "done")
    } else if (config.autoSetup !== false) {
      log("info", `[2/4] OpenCode não encontrado. Iniciando instalação remota no servidor...`)

      const installCmd = [
        pathPrefix,
        "mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global 2>/dev/null",
        "(command -v npm >/dev/null 2>&1 && npm install -g @opencode-ai/server) || (curl -fsSL https://opencode.ai/install.sh 2>/dev/null | bash) || echo 'INSTALL_FAILED'",
      ].join(" && ")

      const installResult = await runRemoteCommand(config, installCmd, 120_000, (chunk, stream) => {
        const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean)
        lines.forEach((l) => log(stream, l))
      })

      const verifyCmd = `${pathPrefix}; opencode --version 2>/dev/null || echo "NOT_INSTALLED"`
      const verifyResult = await runRemoteCommand(config, verifyCmd, 15_000)

      if (verifyResult.success && verifyResult.output && !verifyResult.output.includes("NOT_INSTALLED")) {
        installedVersion = verifyResult.output.split("\n").pop()?.trim() || "instalado"
        log("success", `[2/4] OpenCode instalado com sucesso no servidor (versão: ${installedVersion}).`)
        setStep("check_install", "done")
      } else {
        const errorMsg = installResult.error || "Não foi possível instalar o OpenCode automaticamente na VPS."
        setStep("check_install", "failed", errorMsg)
        log("error", `Falha na instalação remota: ${errorMsg}`)
        throw new Error(`Falha na instalação remota do OpenCode: ${errorMsg}`)
      }
    } else {
      const errorMsg = "OpenCode não está instalado no servidor remoto e o autoSetup está desativado."
      setStep("check_install", "failed", errorMsg)
      log("error", errorMsg)
      throw new Error(errorMsg)
    }
  }

  // ==========================================
  // ETAPA 3: Iniciar e Verificar Serviço OpenCode Remoto
  // ==========================================
  setStep("start_service", "running")
  log("info", `[3/4] Verificando se o serviço OpenCode está rodando na porta ${config.remotePort}...`)

  const probeRemoteHealth =
    `(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${config.remotePort}/global/health 2>/dev/null) || ` +
    `(ss -tlnp 2>/dev/null | grep -q ":${config.remotePort} " && echo "RUNNING") || echo "NOT_RUNNING"`

  const initialHealth = await runRemoteCommand(config, probeRemoteHealth, 8000)
  const healthOutput = initialHealth.output.trim()
  let isRunning =
    initialHealth.success &&
    (healthOutput === "200" || healthOutput === "401" || healthOutput === "RUNNING" || healthOutput.length === 3)

  if (!isRunning) {
    log("info", `[3/4] Inicializando serviço OpenCode na porta ${config.remotePort}...`)

    // Se existe serviço systemd, tenta iniciar pelo systemctl
    const hasSystemd = await runRemoteCommand(config, "systemctl is-active opencode 2>/dev/null || echo 'inactive'", 4000)
    if (hasSystemd.output.includes("inactive") || hasSystemd.output.includes("failed")) {
      await runRemoteCommand(config, "systemctl start opencode 2>/dev/null || true", 6000)
    } else {
      // Inicia em background
      const envVars = [
        pathPrefix,
        config.serverPassword ? `export OPENCODE_SERVER_PASSWORD="${config.serverPassword}"` : "",
        config.serverUsername ? `export OPENCODE_SERVER_USERNAME="${config.serverUsername}"` : "",
      ]
        .filter(Boolean)
        .join(" && ")

      const startCmd = `${envVars} && nohup opencode serve --port ${config.remotePort} --hostname 0.0.0.0 > ~/.opencode-server.log 2>&1 &`
      await runRemoteCommand(config, startCmd, 12_000)
    }

    // Polling sequencial de até 8 segundos no servidor remoto
    for (let attempt = 1; attempt <= 8; attempt++) {
      await sleep(1000)
      const healthCheck = await runRemoteCommand(config, probeRemoteHealth, 4000)
      const code = healthCheck.output.trim()
      if (code === "200" || code === "401" || code === "RUNNING" || code.length === 3) {
        isRunning = true
        break
      }
    }

    if (!isRunning) {
      const tailLogs = await runRemoteCommand(config, "tail -n 15 ~/.opencode-server.log 2>/dev/null", 4000)
      if (tailLogs.output) {
        log("stderr", `Logs do servidor:\n${tailLogs.output}`)
      }
      const errorMsg = `O serviço OpenCode não respondeu na porta ${config.remotePort} após inicialização.`
      setStep("start_service", "failed", errorMsg)
      log("error", errorMsg)
      throw new Error(errorMsg)
    }
  }

  setStep("start_service", "done")
  log("success", `[3/4] Serviço OpenCode ativo e respondendo na porta ${config.remotePort}.`)

  // ==========================================
  // ETAPA 4: Estabelecer Túnel SSH Local e Validar
  // ==========================================
  setStep("tunnel", "running")
  const localPort = await allocatePort()
  log("info", `[4/4] Estabelecendo túnel SSH local 127.0.0.1:${localPort} -> 127.0.0.1:${config.remotePort}...`)

  const args = [
    "-N",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=" + (config.sshPassword ? "no" : "yes"),
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
  }

  let child: ReturnType<typeof spawn>
  try {
    let cmd = "ssh"
    const spawnOpts: Parameters<typeof spawn>[2] = { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    if (config.sshPassword) {
      cmd = "sshpass"
      spawnOpts.env = { ...process.env, SSHPASS: config.sshPassword }
      args.unshift("-e")
      args.unshift("ssh")
    }
    child = spawn(cmd, args, spawnOpts)
  } catch (err) {
    const errorMsg = `Falha ao iniciar processo do túnel SSH: ${err instanceof Error ? err.message : String(err)}`
    setStep("tunnel", "failed", errorMsg)
    log("error", errorMsg)
    throw new Error(errorMsg)
  }

  const recentOutput: string[] = []
  const emit = (stream: "stdout" | "stderr", text: string) => {
    recentOutput.push(`[${stream}] ${text}`)
    if (recentOutput.length > 12) recentOutput.shift()
    opts.onLine?.({ stream, text })
    log(stream, text)
  }
  if (child.stdout) forwardLines(child.stdout, (text) => emit("stdout", text))
  if (child.stderr) forwardLines(child.stderr, (text) => emit("stderr", text))

  const exit = new Promise<never>((_, reject) => {
    child.once("error", (error) =>
      reject(
        error.message.includes("ENOENT")
          ? new Error("O comando `ssh` não foi encontrado nesta máquina.")
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
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>(
    (_, reject) =>
      (timeout = setTimeout(
        () => reject(new Error(`Túnel SSH abriu mas o OpenCode não respondeu em ${config.host} em ${timeoutMs}ms.`)),
        timeoutMs,
      )),
  )

  try {
    await Promise.race([health, exit, timedOut])
  } catch (error) {
    child.kill()
    const errorMsg = error instanceof Error ? error.message : String(error)
    setStep("tunnel", "failed", errorMsg)
    log("error", errorMsg)
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    startup.abort()
  }

  setStep("tunnel", "done")
  log("success", `[4/4] Túnel SSH conectado e verificado com sucesso em ${url}!`)

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

export async function updateRemoteOpencode(config: SshServerConfig, opts: SshTunnelOpts = {}): Promise<void> {
  const log = (level: "info" | "stdout" | "stderr" | "success" | "error", message: string) => {
    opts.onLog?.(level, message)
    if (level === "stdout" || level === "stderr") {
      opts.onLine?.({ stream: level, text: message })
    }
  }

  const setStep = (step: SshSetupStep, status: SshStepStatus, error?: string) => {
    opts.onStep?.(step, status, error)
  }

  // 1. Test SSH
  setStep("test_ssh", "running")
  log("info", `[1/3] Conectando via SSH em ${config.sshUsername}@${config.host}:${config.port}...`)
  const testRes = await runRemoteCommand(config, "echo '__OPENCODE_SSH_OK__'", 15_000)
  if (!testRes.success) {
    const errorMsg = testRes.error || "Falha na conexão SSH."
    setStep("test_ssh", "failed", errorMsg)
    log("error", errorMsg)
    throw new Error(errorMsg)
  }
  setStep("test_ssh", "done")
  log("success", `[1/3] Conexão SSH autenticada com sucesso.`)

  // 2. Atualizar OpenCode
  setStep("check_install", "running")
  log("info", `[2/3] Verificando e atualizando OpenCode na VPS...`)

  const checkGitApp = await runRemoteCommand(
    config,
    "su - opencode -c 'cd /home/opencode/app && git status' 2>/dev/null || (cd ~/app && git status) 2>/dev/null || echo 'NOT_GIT'",
    10_000,
  )

  if (!checkGitApp.output.includes("NOT_GIT") && checkGitApp.success) {
    log("info", `[2/3] Atualizando repositório OpenCode na VPS via git...`)
    const gitPullCmd =
      "su - opencode -c 'cd /home/opencode/app && git fetch origin dev && git reset --hard origin/dev && ~/.bun/bin/bun install'"

    await runRemoteCommand(config, gitPullCmd, 120_000, (chunk, stream) => {
      chunk
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => log(stream, l))
    })
    log("success", `[2/3] Repositório atualizado e dependências instaladas.`)
  } else {
    log("info", `[2/3] Atualizando pacote global @opencode-ai/server na VPS...`)
    const pathPrefix = 'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"'
    const updateNpmCmd = `${pathPrefix}; (command -v bun >/dev/null 2>&1 && bun add -g @opencode-ai/server@latest) || npm install -g @opencode-ai/server@latest 2>&1`
    await runRemoteCommand(config, updateNpmCmd, 120_000, (chunk, stream) => {
      chunk
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => log(stream, l))
    })
    log("success", `[2/3] Pacote global atualizado com sucesso.`)
  }
  setStep("check_install", "done")

  // 3. Reiniciar Serviço
  setStep("start_service", "running")
  log("info", `[3/3] Reiniciando serviço OpenCode na VPS...`)
  const checkService = await runRemoteCommand(config, "systemctl is-active opencode 2>/dev/null || echo 'no'", 5000)
  if (!checkService.output.includes("no")) {
    await runRemoteCommand(config, "systemctl restart opencode", 10_000)
  } else {
    const killCmd = `(fuser -k ${config.remotePort}/tcp 2>/dev/null || pkill -f "opencode.*serve" 2>/dev/null || true); sleep 1`
    await runRemoteCommand(config, killCmd, 8000)
    const envVars = [
      'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
      config.serverPassword ? `export OPENCODE_SERVER_PASSWORD="${config.serverPassword}"` : "",
      config.serverUsername ? `export OPENCODE_SERVER_USERNAME="${config.serverUsername}"` : "",
    ]
      .filter(Boolean)
      .join(" && ")
    const startCmd = `${envVars} && nohup opencode serve --port ${config.remotePort} --hostname 0.0.0.0 > ~/.opencode-server.log 2>&1 &`
    await runRemoteCommand(config, startCmd, 12_000)
  }

  // Polling de saúde após restart
  await sleep(1500)
  const probeRemoteHealth =
    `(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${config.remotePort}/global/health 2>/dev/null) || ` +
    `(ss -tlnp 2>/dev/null | grep -q ":${config.remotePort} " && echo "RUNNING") || echo "NOT_RUNNING"`

  let isRunning = false
  for (let attempt = 1; attempt <= 10; attempt++) {
    await sleep(1000)
    const healthCheck = await runRemoteCommand(config, probeRemoteHealth, 4000)
    const code = healthCheck.output.trim()
    if (code === "200" || code === "401" || code === "RUNNING" || code.length === 3) {
      isRunning = true
      break
    }
  }

  if (!isRunning) {
    const errorMsg = `Serviço OpenCode não respondeu na porta ${config.remotePort} após atualização.`
    setStep("start_service", "failed", errorMsg)
    log("error", errorMsg)
    throw new Error(errorMsg)
  }

  setStep("start_service", "done")
  log("success", `[3/3] Serviço OpenCode atualizado e reiniciado com sucesso!`)
}

function sshFailure(code: number | null, signal: NodeJS.Signals | null, recentOutput: string[]) {
  const suffix = recentOutput.length ? `\n${recentOutput.join("\n")}` : ""
  return `ssh saiu antes do túnel ficar pronto (code=${code ?? "null"}, signal=${signal ?? "null"})${suffix}`
}
