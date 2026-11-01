import type { SessionV1 } from "@opencode-ai/core/v1/session"

export function buildTranscript(messages: SessionV1.WithParts[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.info.role === "user" ? "Usuário" : "Assistente"
    const textParts: string[] = []
    for (const part of msg.parts) {
      if ("text" in part && typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text.trim())
      } else if (part.type === "tool" && "tool" in part) {
        textParts.push(`[Chamou ferramenta: ${part.tool}]`)
      } else if (part.type === "patch" && "file" in part) {
        textParts.push(`[Alterou arquivo: ${part.file}]`)
      }
    }
    if (textParts.length > 0) {
      lines.push(`${role}: ${textParts.join("\n")}`)
    }
  }
  return lines.join("\n\n")
}

export function extractHeuristicSummary(transcript: string): string {
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean)
  const keyPoints: string[] = []
  for (const line of lines) {
    if (line.startsWith("Usuário:") || line.startsWith("User:")) {
      const clean = line.replace(/^(Usuário|User):\s*/, "").slice(0, 200)
      if (clean.length > 5) keyPoints.push(`- **Pedido/Discussão**: ${clean}`)
    } else if (line.startsWith("[Alterou arquivo:")) {
      keyPoints.push(`- **Alteração**: ${line}`)
    }
  }
  return keyPoints.slice(0, 8).join("\n") || "- Registro automático da sessão."
}
