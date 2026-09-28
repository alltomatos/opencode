import { createQuery, useQueryClient } from "@tanstack/solid-query"
import type { BatutaActivity } from "@opencode-ai/sdk/v2"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"

export const BATUTA_QUERY_KEY = "batuta-activities"

export function useBatutaQuery() {
  const server = useServer()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()

  const batutaClient = () => (serverSDK().client as any).batuta

  const query = createQuery<BatutaActivity[]>(() => ({
    queryKey: [BATUTA_QUERY_KEY, server.key],
    queryFn: async () => {
      const client = batutaClient()
      if (!client) return []
      const result = await client.list()
      return (result.data ?? []) as BatutaActivity[]
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  }))

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [BATUTA_QUERY_KEY, server.key] })
  }

  return {
    query,
    activities: () => query.data ?? [],
    loading: () => query.isLoading && !query.data,
    refetch: () => query.refetch(),
    invalidate,
    batutaClient,
  }
}
