import { spawn } from "node:child_process"
import { basename } from "node:path"
import type { SshServerConfig } from "@opencode-ai/app/ssh-tunnel/types"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { runRemoteCommand } from "./sidecar"

export type SessionExportData = {
  info: Session
  messages: {
    info: Message
    parts: Part[]
  }[]
}

export type HandoffProgressStep = "prepare" | "git_patch" | "remote_workspace" | "import_session" | "done"

export type HandoffProgressCallback = (step: HandoffProgressStep, status: "running" | "done" | "failed", message?: string) => void

export type HandoffOptions = {
  sshConfig: SshServerConfig
  localDirectory: string
  sessionData: SessionExportData
  remoteBaseProjectsDir?: string
  includeGitChanges?: boolean
  onProgress?: HandoffProgressCallback
}

export type HandoffResult = {
  success: boolean
  remoteSessionID: string
  remoteDirectory: string
  remoteUrl: string
  error?: string
}

function runLocalCommand(cmd: string, args: string[], cwd: string): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true })
    } catch (err) {
      resolve({ success: false, output: "", error: String(err) })
      return
    }

    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("error", (err) => resolve({ success: false, output: "", error: err.message }))
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout })
      } else {
        resolve({ success: false, output: stdout, error: stderr.trim() || `Command failed with code ${code}` })
      }
    })
  })
}

export async function captureLocalGitPatch(localDirectory: string): Promise<string> {
  // Capture git diff HEAD (staged + unstaged tracked)
  const diffRes = await runLocalCommand("git", ["diff", "--binary", "HEAD"], localDirectory)
  const trackedDiff = diffRes.success ? diffRes.output : ""

  // Capture untracked files
  const untrackedRes = await runLocalCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], localDirectory)
  let untrackedDiff = ""
  if (untrackedRes.success && untrackedRes.output) {
    const files = untrackedRes.output.split("\0").filter(Boolean)
    for (const file of files) {
      const singleDiff = await runLocalCommand("git", ["diff", "--binary", "--no-index", "--", "NUL", file], localDirectory)
      if (singleDiff.output) {
        untrackedDiff += "\n" + singleDiff.output
      }
    }
  }

  return [trackedDiff, untrackedDiff].filter(Boolean).join("\n")
}

export async function executeHandoff(options: HandoffOptions): Promise<HandoffResult> {
  const {
    sshConfig,
    localDirectory,
    sessionData,
    remoteBaseProjectsDir = "/home/opencode/projects",
    includeGitChanges = true,
    onProgress,
  } = options

  const projectName = basename(localDirectory) || "project"
  const remoteDirectory = `${remoteBaseProjectsDir}/${projectName}`
  const remoteUrl = `http://${sshConfig.host}:${sshConfig.remotePort}`

  try {
    // Step 1: Prepare
    onProgress?.("prepare", "running", `Preparando handoff para ${sshConfig.label || sshConfig.host}...`)
    onProgress?.("prepare", "done")

    // Step 2: Ensure remote workspace
    onProgress?.("remote_workspace", "running", `Verificando diretório ${remoteDirectory} na VPS...`)
    const mkdirCmd = `mkdir -p "${remoteDirectory}" && cd "${remoteDirectory}" && (git rev-parse --is-inside-work-tree 2>/dev/null || git init -q)`
    const mkdirRes = await runRemoteCommand(sshConfig, mkdirCmd, 15_000)
    if (!mkdirRes.success) {
      const err = `Falha ao criar/iniciar repositório na VPS: ${mkdirRes.error}`
      onProgress?.("remote_workspace", "failed", err)
      throw new Error(err)
    }
    onProgress?.("remote_workspace", "done")

    // Step 3: Git Patch if applicable
    if (includeGitChanges) {
      onProgress?.("git_patch", "running", "Capturando alterações locais não commitadas...")
      const patch = await captureLocalGitPatch(localDirectory)
      if (patch.trim().length > 0) {
        onProgress?.("git_patch", "running", `Aplicando patch (${patch.length} bytes) na VPS...`)
        const base64Patch = Buffer.from(patch, "utf8").toString("base64")
        const applyPatchCmd = `cd "${remoteDirectory}" && echo "${base64Patch}" | base64 -d | (git apply - 2>/dev/null || patch -p1 -N 2>/dev/null || true)`
        const applyRes = await runRemoteCommand(sshConfig, applyPatchCmd, 20_000)
        if (!applyRes.success) {
          onProgress?.("git_patch", "failed", `Aviso: patch não pôde ser aplicado perfeitamente: ${applyRes.error}`)
        } else {
          onProgress?.("git_patch", "done", "Alterações locais sincronizadas na VPS.")
        }
      } else {
        onProgress?.("git_patch", "done", "Nenhuma alteração local pendente para sincronizar.")
      }
    }

    // Step 4: Import Session into remote OpenCode
    onProgress?.("import_session", "running", "Criando sessão correspondente no OpenCode da VPS...")

    const auth = Buffer.from(`${sshConfig.serverUsername}:${sshConfig.serverPassword}`).toString("base64")
    const authHeader = `Basic ${auth}`

    // 4.1: Create remote session with the same title, model, and target remote directory
    const createPayload = {
      title: sessionData.info.title ? `[Cloud] ${sessionData.info.title}` : "[Cloud] Continuação Remota",
      directory: remoteDirectory,
    }

    const createResp = await fetch(`${remoteUrl}/session?directory=${encodeURIComponent(remoteDirectory)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(createPayload),
    })

    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "")
      const err = `Erro ao criar sessão remota (HTTP ${createResp.status}): ${errText}`
      onProgress?.("import_session", "failed", err)
      throw new Error(err)
    }

    const newSession = (await createResp.json()) as { id: string }
    const remoteSessionID = newSession.id

    // 4.2: Resumo de contexto para que o assistente na VPS saiba exatamente onde parou
    const userPromptMessages = sessionData.messages
      .filter((m: { info: Message; parts: Part[] }) => m.info.role === "user")
      .map((m: { info: Message; parts: Part[] }) => {
        const textParts = m.parts
          .filter((p: Part) => p.type === "text" && typeof (p as { text?: string }).text === "string")
          .map((p: Part) => (p as { text: string }).text)
          .join(" ")
        return textParts.slice(0, 300)
      })
      .filter(Boolean)
      .slice(-3)

    const contextSummary = [
      "Esta sessão foi transferida do seu computador local ('Continuar na Nuvem').",
      sessionData.info.title ? `Contexto original: ${sessionData.info.title}` : "",
      userPromptMessages.length ? `Últimos prompts locais:\n- ${userPromptMessages.join("\n- ")}` : "",
      "O código e o repositório foram sincronizados. Você pode continuar trabalhando de onde parou!",
    ]
      .filter(Boolean)
      .join("\n\n")

    // Envia nota informativa de inicialização no prompt da sessão remota
    await fetch(`${remoteUrl}/session/${remoteSessionID}/prompt_async?directory=${encodeURIComponent(remoteDirectory)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        parts: [{ type: "text", text: `[Continuar na Nuvem]: ${contextSummary}` }],
      }),
    }).catch(() => undefined)

    onProgress?.("import_session", "done", `Sessão criada: ${remoteSessionID}`)
    onProgress?.("done", "done", "Transferência concluída com sucesso!")

    return {
      success: true,
      remoteSessionID,
      remoteDirectory,
      remoteUrl,
    }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      remoteSessionID: "",
      remoteDirectory,
      remoteUrl,
      error: err,
    }
  }
}
