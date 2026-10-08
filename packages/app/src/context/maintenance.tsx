import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, onMount } from "solid-js"
import { usePlatform } from "./platform"

export type MaintenanceStatus = {
  dbSizeBytes: number
  walSizeBytes: number
  eventCount: number
  largeEventCount: number
  needsMaintenance: boolean
}

export type MaintenanceRunResult = {
  freedBytes: number
  purgedEvents: number
  durationMs: number
}

const CHECK_INTERVAL_MS = 60_000

export const { use: useMaintenance, provider: MaintenanceProvider } = createSimpleContext({
  name: "Maintenance",
  init: () => {
    const platform = usePlatform()
    const [status, setStatus] = createSignal<MaintenanceStatus | null>(null)
    const [running, setRunning] = createSignal(false)

    const check = async () => {
      if (platform.platform !== "desktop" || !platform.getMaintenanceStatus) return
      try {
        const res = await platform.getMaintenanceStatus()
        setStatus(res)
      } catch {}
    }

    const run = async (): Promise<MaintenanceRunResult | null> => {
      if (platform.platform !== "desktop" || !platform.runMaintenance || running()) return null
      setRunning(true)
      try {
        const res = await platform.runMaintenance()
        await check()
        return res
      } finally {
        setRunning(false)
      }
    }

    onMount(() => {
      void check()
      const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
    })

    return {
      status,
      running,
      check,
      run,
      needsMaintenance: () => Boolean(status()?.needsMaintenance),
    }
  },
})
