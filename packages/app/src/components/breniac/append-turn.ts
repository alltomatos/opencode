import type { useServerSDK } from "@/context/server-sdk"

export async function appendTurn(
  serverSDK: ReturnType<typeof useServerSDK>,
  voiceSessionID: string,
  transcript: string,
  response: string,
): Promise<void> {
  const result = await serverSDK().client.breniac.appendTurn({
    breniacAppendTurnRequest: { voiceSessionID, transcript, response },
  })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha ao gravar o turno")
}
