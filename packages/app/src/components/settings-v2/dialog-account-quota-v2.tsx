import { Component, For, Show } from "solid-js"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export interface QuotaBucket {
  modelId: string
  remainingFraction: number
  remainingPercentage: number
  resetTime: string | null
}

export interface AccountQuotaModalData {
  accountLabel: string
  tier: "pro" | "free" | "unknown"
  overallPercentage: number
  buckets: QuotaBucket[]
}

function formatReset(resetTime: string | null): string {
  if (!resetTime) return "-"
  try {
    const d = new Date(resetTime)
    if (isNaN(d.getTime())) return resetTime
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return resetTime
  }
}

export const DialogAccountQuotaV2: Component<{
  data: AccountQuotaModalData
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog fit class="settings-v2-server-dialog max-w-[520px] max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>
          <div class="flex items-center gap-2">
            <span>{language.t("settings.providers.quota.dialogTitle", { account: props.data.accountLabel })}</span>
            <Show
              when={props.data.tier === "pro"}
              fallback={<Tag variant="neutral">{language.t("settings.providers.quota.tier.free")}</Tag>}
            >
              <Tag variant="accent">{language.t("settings.providers.quota.tier.pro")}</Tag>
            </Show>
          </div>
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-3 px-4 pt-4 pb-2 overflow-y-auto">
        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-raised p-3 shrink-0">
          <span class="text-13-medium text-v2-text-text-base">{language.t("settings.providers.quota.overall")}</span>
          <div class="flex items-center gap-2">
            <span class="text-14-medium text-v2-text-text-strong">{props.data.overallPercentage}%</span>
            <div class="h-2 w-20 overflow-hidden rounded-full bg-v2-border-border-base">
              <div
                class="h-full rounded-full transition-all"
                classList={{
                  "bg-v2-state-fg-success": props.data.overallPercentage > 50,
                  "bg-v2-state-fg-warning": props.data.overallPercentage <= 50 && props.data.overallPercentage > 15,
                  "bg-v2-state-fg-danger": props.data.overallPercentage <= 15,
                }}
                style={{ width: `${Math.max(4, Math.min(100, props.data.overallPercentage))}%` }}
              />
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-1.5 min-h-0">
          <span class="text-11-medium text-v2-text-text-faint uppercase tracking-wider shrink-0">
            {language.t("settings.providers.quota.modelsDetail")}
          </span>
          <div class="flex flex-col divide-y divide-v2-border-border-base rounded-md border border-v2-border-border-base overflow-y-auto max-h-[360px]">
            <For
              each={
                props.data.buckets.length > 0
                  ? props.data.buckets
                  : [
                      { modelId: "gemini-2.5-flash", remainingFraction: 1, remainingPercentage: 100, resetTime: null },
                      { modelId: "gemini-2.5-flash-lite", remainingFraction: 1, remainingPercentage: 100, resetTime: null },
                      { modelId: "gemini-2.5-flash-thinking", remainingFraction: 1, remainingPercentage: 100, resetTime: null },
                      { modelId: "gemini-3-flash", remainingFraction: 1, remainingPercentage: 100, resetTime: null },
                      { modelId: "gemini-3.1-flash-lite", remainingFraction: 1, remainingPercentage: 100, resetTime: null },
                    ]
              }
            >
              {(b) => (
                <div class="flex items-center justify-between p-2.5 text-12-regular hover:bg-v2-background-bg-raised transition-colors">
                  <div class="flex flex-col min-w-0 pr-2">
                    <span class="font-medium text-v2-text-text-base truncate">{b.modelId}</span>
                    <Show when={b.resetTime}>
                      <span class="text-11-regular text-v2-text-text-faint">
                        {language.t("settings.providers.quota.resetsAt", { time: formatReset(b.resetTime) })}
                      </span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      class="text-12-medium"
                      classList={{
                        "text-v2-state-fg-success": b.remainingPercentage > 50,
                        "text-v2-state-fg-warning": b.remainingPercentage <= 50 && b.remainingPercentage > 15,
                        "text-v2-state-fg-danger": b.remainingPercentage <= 15,
                      }}
                    >
                      {b.remainingPercentage}%
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
