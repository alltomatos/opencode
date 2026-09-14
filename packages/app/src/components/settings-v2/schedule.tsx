import { createSignal, For, Show, type Component } from "solid-js"
import { createResource } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type TriggerKind = "cron" | "interval" | "manual"

function triggerSummary(trigger: { kind: string; expr?: string; ms?: number | string }): string {
  if (trigger.kind === "cron") return `cron: ${trigger.expr}`
  if (trigger.kind === "interval") return `every ${Math.round(Number(trigger.ms ?? 0) / 60_000)}m`
  return "manual"
}

function actionSummary(action: { kind: string; command?: string; server?: string; tool?: string; name?: string }): string {
  if (action.kind === "shell") return action.command ?? ""
  if (action.kind === "mcp_tool") return `${action.server}/${action.tool}`
  return `skill: ${action.name}`
}

export const SettingsScheduleV2: Component = () => {
  const serverSDK = useServerSDK()

  const [schedules, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.v2.schedule.list()
    return result.data ?? []
  })

  const [triggerKind, setTriggerKind] = createSignal<TriggerKind>("cron")
  const [cronExpr, setCronExpr] = createSignal("*/5 * * * *")
  const [intervalMinutes, setIntervalMinutes] = createSignal("5")
  const [command, setCommand] = createSignal("")

  const createMutation = useMutation(() => ({
    mutationFn: async () => {
      const kind = triggerKind()
      const trigger =
        kind === "cron"
          ? ({ kind: "cron", expr: cronExpr() } as const)
          : kind === "interval"
            ? ({ kind: "interval", ms: Math.max(1, Number(intervalMinutes()) || 0) * 60_000 } as const)
            : ({ kind: "manual" } as const)
      await serverSDK().client.v2.schedule.create({
        scheduleCreateInput: { trigger, action: { kind: "shell", command: command() } },
      })
    },
    onSuccess: () => {
      setCommand("")
      void refetch()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Request failed", description: message })
    },
  }))

  const runMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.run({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Request failed", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.remove({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Request failed", description: message })
    },
  }))

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">Rotinas</h2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-models flex flex-col gap-4">
        <div class="flex flex-col gap-2 rounded-md bg-v2-background-bg-layer-02 p-3">
          <div class="flex items-center gap-2">
            <SelectV2
              class="!w-[140px] shrink-0"
              options={["cron", "interval", "manual"] as const}
              current={triggerKind()}
              label={(kind) => kind}
              onSelect={(kind) => kind && setTriggerKind(kind)}
            />
            <Show when={triggerKind() === "cron"}>
              <TextInputV2
                class="!w-[200px]"
                value={cronExpr()}
                onInput={(event) => setCronExpr(event.currentTarget.value)}
                placeholder="*/5 * * * *"
              />
            </Show>
            <Show when={triggerKind() === "interval"}>
              <TextInputV2
                class="!w-[100px]"
                type="number"
                value={intervalMinutes()}
                onInput={(event) => setIntervalMinutes(event.currentTarget.value)}
                placeholder="minutes"
              />
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <TextInputV2
              class="!flex-1"
              value={command()}
              onInput={(event) => setCommand(event.currentTarget.value)}
              placeholder="Shell command to run"
            />
            <ButtonV2
              variant="neutral"
              icon="plus"
              disabled={!command().trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Add
            </ButtonV2>
          </div>
          <span class="text-12-regular text-text-weak">
            mcp_tool and skill actions are coming soon — only shell commands run today.
          </span>
        </div>

        <Show
          when={!schedules.loading}
          fallback={<div class="settings-v2-models-status">Loading…</div>}
        >
          <Show
            when={(schedules() ?? []).length > 0}
            fallback={<div class="settings-v2-models-status">No routines yet.</div>}
          >
            <SettingsListV2>
              <For each={schedules()}>
                {(item) => (
                  <SettingsRowV2
                    title={
                      <span class="flex items-center gap-2">
                        <IconV2 name="clock" size="small" />
                        {triggerSummary(item.trigger)}
                      </span>
                    }
                    description={
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="truncate">{actionSummary(item.action)}</span>
                        <Show when={item.lastStatus}>
                          <div class="flex items-center gap-2">
                            <Tag>{item.lastStatus}</Tag>
                            <Show when={item.lastError}>
                              <span class="truncate">{item.lastError}</span>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    <div class="flex items-center gap-1">
                      <IconButtonV2
                        variant="ghost-muted"
                        aria-label="Run now"
                        disabled={runMutation.isPending}
                        onClick={() => runMutation.mutate(item.id)}
                        icon={<IconV2 name="play" size="small" />}
                      />
                      <IconButtonV2
                        variant="ghost-muted"
                        class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                        aria-label="Remove"
                        onClick={() => removeMutation.mutate(item.id)}
                        icon={<IconV2 name="trash" size="small" />}
                      />
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </Show>
        </Show>
      </div>
    </>
  )
}
