import { createResource, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { ScheduleInfo } from "@opencode-ai/sdk/v2"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "@/components/settings-v2/parts/list"
import { SettingsRowV2 } from "@/components/settings-v2/parts/row"
import { triggerSummary, actionSummary } from "./routines/summary"

export const RoutinesPage: Component = () => {
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const dialog = useDialog()

  const [schedules, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.v2.schedule.list()
    return result.data ?? []
  })

  const runMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.run({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível rodar a rotina", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.remove({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível remover a rotina", description: message })
    },
  }))

  const openCreate = () => navigate("/rotinas/new")

  const confirmRemove = (schedule: ScheduleInfo) => {
    dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose={true}>
          <DialogTitle>Remover rotina?</DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-2 pb-4">
          <span class="text-13-regular text-text-weak">
            {triggerSummary(schedule.trigger)} — {actionSummary(schedule.action)}
          </span>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            Cancelar
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              removeMutation.mutate(schedule.id)
            }}
          >
            Remover
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <div
      class={`
        m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-3 py-8 lg:px-6">
          <div class="flex items-center gap-3">
            <div class="flex size-16 shrink-0 items-center justify-center rounded-[14px] bg-v2-background-bg-raised text-v2-icon-icon-base">
              <Icon name="task" size="large" class="size-9" />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <h1 class="text-lg font-medium text-v2-text-text-base">Rotinas</h1>
              <p class="text-sm leading-relaxed text-v2-text-text-muted">
                Tarefas que rodam sozinhas — quando, o que fazer, e por onde.
              </p>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-v2-text-text-base">Suas rotinas</h2>
            <ButtonV2 variant="neutral" onClick={openCreate}>
              <IconV2 name="plus" size="small" />
              Nova rotina
            </ButtonV2>
          </div>

          <Show
            when={!schedules.loading}
            fallback={
              <div class="flex items-center gap-2 py-6 text-sm text-v2-text-text-muted">
                <span
                  class={`
                    size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-v2-border-border-base
                    border-t-v2-icon-icon-base
                  `}
                />
                Carregando…
              </div>
            }
          >
            <Show
              when={(schedules() ?? []).length > 0}
              fallback={
                <div
                  class={`
                    flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-v2-border-border-base
                    px-6 py-10 text-center
                  `}
                >
                  <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-raised text-v2-icon-icon-muted">
                    <Icon name="task" size="normal" />
                  </div>
                  <p class="text-sm text-v2-text-text-muted">Nenhuma rotina ainda.</p>
                  <ButtonV2 variant="neutral" onClick={openCreate}>
                    <IconV2 name="plus" size="small" />
                    Nova rotina
                  </ButtonV2>
                </div>
              }
            >
              <SettingsListV2>
                <For each={schedules()}>
                  {(schedule) => {
                    const running = () => runMutation.isPending && runMutation.variables === schedule.id
                    return (
                      <SettingsRowV2
                        title={
                          <span class="flex items-center gap-2">
                            <Icon name="task" size="small" />
                            {triggerSummary(schedule.trigger)}
                          </span>
                        }
                        description={
                          <div class="flex min-w-0 flex-col gap-1">
                            <span class="truncate text-v2-text-text-muted">{actionSummary(schedule.action)}</span>
                            <Show when={schedule.lastStatus || running()}>
                              <div class="flex items-center gap-2">
                                <Show when={running()} fallback={<Tag>{schedule.lastStatus}</Tag>}>
                                  <Tag variant="accent">rodando…</Tag>
                                </Show>
                                <Show when={schedule.lastRunAt}>
                                  <span class="text-v2-text-text-faint">
                                    última execução: {new Date(schedule.lastRunAt!).toLocaleString()}
                                  </span>
                                </Show>
                                <Show when={schedule.lastError}>
                                  <span class="truncate text-v2-state-fg-danger">{schedule.lastError}</span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        }
                      >
                        <div class="flex items-center gap-1">
                          <ButtonV2
                            variant="contrast"
                            size="normal"
                            disabled={running()}
                            onClick={() => runMutation.mutate(schedule.id)}
                          >
                            {running() ? "Rodando…" : "Rodar agora"}
                          </ButtonV2>
                          <IconButtonV2
                            variant="ghost-muted"
                            class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                            aria-label="Remover"
                            onClick={() => confirmRemove(schedule)}
                            icon={<IconV2 name="close" size="small" />}
                          />
                        </div>
                      </SettingsRowV2>
                    )
                  }}
                </For>
              </SettingsListV2>
            </Show>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
