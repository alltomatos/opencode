import type { useServerSDK } from "@/context/server-sdk"

export type SummarizeResult = {
  summarized: boolean
  summary?: string
  suggestsGlobal?: boolean
  globalReason?: string
}

export async function summarizeVoiceSession(
  serverSDK: ReturnType<typeof useServerSDK>,
  voiceSessionID: string,
  directory: string,
): Promise<SummarizeResult> {
  const result = await serverSDK().client.breniac.summarize({
    breniacSummarizeRequest: { voiceSessionID, directory },
  })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha ao resumir")
  return result.data ?? { summarized: false }
}

export async function promoteSummaryToGlobal(serverSDK: ReturnType<typeof useServerSDK>, summary: string): Promise<void> {
  const result = await serverSDK().client.breniac.promoteGlobal({ breniacPromoteGlobalRequest: { summary } })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha ao promover pra global")
}
