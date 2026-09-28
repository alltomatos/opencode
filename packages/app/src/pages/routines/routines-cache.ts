import { createQuery, useQueryClient } from "@tanstack/solid-query"
import type { ScheduleInfo } from "@opencode-ai/sdk/v2"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"

export const ROUTINES_QUERY_KEY = "routines-schedules"

export function useRoutinesQuery() {
  const server = useServer()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()

  const scheduleClient = () => (serverSDK().client as any).schedule ?? (serverSDK().client as any).v2?.schedule

  const query = createQuery<ScheduleInfo[]>(() => ({
    queryKey: [ROUTINES_QUERY_KEY, server.key],
    queryFn: async () => {
      const client = scheduleClient()
      if (!client) return []
      const result = await client.list()
      return (result.data ?? []) as ScheduleInfo[]
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  }))

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [ROUTINES_QUERY_KEY, server.key] })
  }

  return {
    query,
    schedules: () => query.data ?? [],
    loading: () => query.isLoading && !query.data,
    refetch: () => query.refetch(),
    invalidate,
    scheduleClient,
  }
}
