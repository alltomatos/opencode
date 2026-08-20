import type { useServerSDK } from "@/context/server-sdk"

const MAX_CHARS = 1200

/**
 * Texto (truncado) da última mensagem do agente na sessão atual — sem isso o
 * Breniac não tinha NENHUM acesso ao conteúdo real da sessão e inventava
 * respostas quando perguntado "o que o agente disse" (confirmado num teste
 * real: ele afirmou ter "analisado" uma resposta que nunca recebeu).
 */
export async function getLastAssistantMessage(
  serverSDK: ReturnType<typeof useServerSDK>,
  sessionID: string,
  directory: string,
): Promise<string | undefined> {
  const result = await serverSDK()
    .client.session.messages({ sessionID, directory, limit: 6 })
    .catch(() => undefined)
  const messages = result?.data
  if (!messages) return undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.info.role !== "assistant") continue
    const text = message.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (!text) continue
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text
  }
  return undefined
}
