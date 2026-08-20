import type { useServerSDK } from "@/context/server-sdk"

export async function loadMemoryContext(
  serverSDK: ReturnType<typeof useServerSDK>,
  projectDirectory: string | undefined,
): Promise<string> {
  const result = await serverSDK().client.breniac.loadMemory({ projectDirectory })
  if (result.error) return ""
  return result.data?.context ?? ""
}
