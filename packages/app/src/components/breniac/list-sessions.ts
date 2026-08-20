import type { useServerSDK } from "@/context/server-sdk"

const LIMIT = 6

export async function listRecentSessions(serverSDK: ReturnType<typeof useServerSDK>, directory: string) {
  const result = await serverSDK()
    .client.session.list({ directory, roots: true, limit: LIMIT })
    .catch(() => undefined)
  return (result?.data ?? []).filter((session) => !session.parentID)
}
