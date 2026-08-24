import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

type JobStatus = "running" | "completed" | "error" | "cancelled"

type BackgroundJobInfo = {
  id: string
  type: string
  title?: string
  status: JobStatus
  started_at: number
  completed_at?: number
  error?: string
}

const POLL_MS = 4000
const TICK_MS = 1000
const MAX_COMPLETED = 10

function elapsedLabel(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest}s`
  return `${minutes}m ${rest}s`
}

export function DialogBackgroundTasks() {
  const language = useLanguage()
  const sdk = useSDK()

  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>([])
  const [now, setNow] = createSignal(Date.now())

  let dead = false
  const refresh = async () => {
    try {
      const result = await sdk().client.experimental.backgroundJob.list()
      if (dead) return
      setJobs((result.data ?? []) as BackgroundJobInfo[])
    } catch {
      // Transient network/server errors are fine to ignore here — the next
      // poll retries, and there's no user action blocked on this succeeding.
    }
  }

  onMount(() => {
    void refresh()
    const pollId = setInterval(() => void refresh(), POLL_MS)
    const tickId = setInterval(() => setNow(Date.now()), TICK_MS)
    onCleanup(() => {
      dead = true
      clearInterval(pollId)
      clearInterval(tickId)
    })
  })

  const running = createMemo(() => jobs().filter((job) => job.status === "running"))
  const completed = createMemo(() =>
    jobs()
      .filter((job) => job.status !== "running")
      .toSorted((a, b) => (b.completed_at ?? b.started_at) - (a.completed_at ?? a.started_at))
      .slice(0, MAX_COMPLETED),
  )

  const cancel = async (id: string) => {
    try {
      await sdk().client.experimental.backgroundJob.cancel({ id })
    } finally {
      void refresh()
    }
  }

  const statusLabel = (job: BackgroundJobInfo) => {
    if (job.status === "completed") return language.t("ui.backgroundTasks.status.completed")
    if (job.status === "error") return language.t("ui.backgroundTasks.status.error")
    return language.t("ui.backgroundTasks.status.cancelled")
  }

  return (
    <DialogV2 fit containerClass="!h-auto max-h-[calc(100vh_-_16px)] !w-[min(calc(100vw_-_16px),420px)]">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("ui.backgroundTasks.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="max-h-[min(70vh,480px)] min-h-0 flex-none gap-0 overflow-y-auto px-2 pb-2">
        <Show
          when={running().length > 0 || completed().length > 0}
          fallback={
            <div class="px-3 py-6 text-13-regular text-text-weak text-center">
              {language.t("ui.backgroundTasks.empty")}
            </div>
          }
        >
          <Show when={running().length > 0}>
            <div class="px-3 pt-2 pb-1 text-11-medium text-text-weaker uppercase tracking-wide">
              {language.t("ui.backgroundTasks.running")}
            </div>
            <For each={running()}>
              {(job) => (
                <div class="flex items-center gap-2 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <TextShimmer text={job.title ?? job.type} class="text-13-regular truncate block" />
                    <div class="text-12-regular text-text-weak">{elapsedLabel(job.started_at, now())}</div>
                  </div>
                  <TooltipV2 placement="left" value={language.t("ui.backgroundTasks.cancel")}>
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      aria-label={language.t("ui.backgroundTasks.cancel")}
                      onClick={() => void cancel(job.id)}
                      icon={<IconV2 name="xmark-small" />}
                    />
                  </TooltipV2>
                </div>
              )}
            </For>
          </Show>
          <Show when={completed().length > 0}>
            <div class="px-3 pt-2 pb-1 text-11-medium text-text-weaker uppercase tracking-wide">
              {language.t("ui.backgroundTasks.completed")}
            </div>
            <For each={completed()}>
              {(job) => (
                <div class="flex items-center gap-2 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="text-13-regular truncate">{job.title ?? job.type}</div>
                    <div class="text-12-regular text-text-weak">{statusLabel(job)}</div>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </DialogBody>
    </DialogV2>
  )
}
