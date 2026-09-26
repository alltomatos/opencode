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
import { sessionHref } from "@/utils/session-route"
import { useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { GlobalLoading } from "@/components/global-loading"
import { triggerSummary, actionSummary } from "./routines/summary"

export const RoutinesPage: Component = () => {
  const server = useServer()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const dialog = useDialog()

  const scheduleClient = () => (serverSDK().client as any).schedule ?? (serverSDK().client as any).v2?.schedule

  const [schedules, { refetch }] = createResource(async () => {
    const result = await scheduleClient().list()
    return result.data ?? []
  })

  const runMutation = useMutation(() => ({
    mutationFn: async (id: string) => scheduleClient().run({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível rodar a rotina", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => scheduleClient().remove({ scheduleID: id }),
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
            {schedule.name || triggerSummary(schedule.trigger)} — {actionSummary(schedule.action)}
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
        <div class="mx-auto flex w-full max-w-[840px] flex-col gap-6 px-3 py-8 lg:px-6">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="flex size-14 shrink-0 items-center justify-center rounded-[12px] bg-v2-background-bg-raised text-v2-icon-icon-base border border-v2-border-border-base">
                <Icon name="task" size="large" class="size-8" />
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <h1 class="text-lg font-semibold text-v2-text-text-base">Rotinas</h1>
                <p class="text-12-regular text-v2-text-text-muted">
                  Automações periódicas com IA, execuções e histórico de sessão.
                </p>
              </div>
            </div>
            <ButtonV2 variant="contrast" onClick={openCreate}>
              <IconV2 name="plus" size="small" />
              Nova rotina
            </ButtonV2>
          </div>

          <div class="flex items-center justify-between border-b border-v2-border-border-base pb-2">
            <h2 class="text-13-medium text-v2-text-text-base font-semibold">Suas rotinas ativas</h2>
            <span class="text-11-regular text-text-weak">
              {(schedules() ?? []).length} {schedules()?.length === 1 ? "rotina cadastrada" : "rotinas cadastradas"}
            </span>
          </div>

          <Show
            when={!schedules.loading}
            fallback={<GlobalLoading size="small" class="py-12" />}
          >
            <Show
              when={(schedules() ?? []).length > 0}
              fallback={
                <div
                  class={`
                    flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-v2-border-border-base
                    px-6 py-12 text-center bg-v2-background-bg-layer-01
                  `}
                >
                  <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-raised text-v2-icon-icon-muted">
                    <Icon name="task" size="normal" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <p class="text-13-medium text-v2-text-text-base font-semibold">Nenhuma rotina ainda.</p>
                    <p class="text-12-regular text-v2-text-text-muted">
                      Crie rotinas para automatizar leitura de emails com notificação WhatsApp, code reviews diários e mais.
                    </p>
                  </div>
                  <ButtonV2 variant="contrast" onClick={openCreate}>
                    <IconV2 name="plus" size="small" />
                    Criar primeira rotina
                  </ButtonV2>
                </div>
              }
            >
              <div class="grid grid-cols-1 gap-3">
                <For each={schedules()}>
                  {(schedule) => {
                    const running = () => runMutation.isPending && runMutation.variables === schedule.id
                    const displayName = () =>
                      schedule.name?.trim() || triggerSummary(schedule.trigger)
                    const hasSession = () => Boolean(schedule.lastSessionId)

                    return (
                      <div
                        class={`
                          flex flex-col gap-3 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02
                          transition-all hover:border-v2-border-border-strong shadow-sm
                        `}
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex min-w-0 flex-col gap-1">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="font-semibold text-14-medium text-v2-text-text-base">
                                {displayName()}
                              </span>
                              <Tag class="text-11-medium bg-v2-background-bg-layer-01 border border-v2-border-border-base">
                                {triggerSummary(schedule.trigger)}
                              </Tag>
                              <Show when={schedule.lastStatus || running()}>
                                <Show
                                  when={running()}
                                  fallback={
                                    <Tag
                                      variant={schedule.lastStatus === "success" ? "neutral" : "accent"}
                                      class={schedule.lastStatus === "success" ? "text-v2-state-fg-success" : "text-v2-state-fg-danger"}
                                    >
                                      {schedule.lastStatus === "success" ? "Concluído" : "Falhou"}
                                    </Tag>
                                  }
                                >
                                  <Tag variant="accent">rodando…</Tag>
                                </Show>
                              </Show>
                            </div>
                            <Show when={schedule.description}>
                              <p class="text-12-regular text-text-weak leading-relaxed">
                                {schedule.description}
                              </p>
                            </Show>
                            <span class="text-12-regular text-v2-text-text-muted line-clamp-2">
                              {actionSummary(schedule.action)}
                            </span>
                          </div>

                          <div class="flex items-center gap-1.5 shrink-0">
                            <ButtonV2
                              variant="neutral"
                              size="normal"
                              onClick={() => navigate(`/rotinas/${schedule.id}/edit`)}
                            >
                              <Icon name="sliders" size="small" />
                              Editar
                            </ButtonV2>
                            <Show when={hasSession()}>
                              <ButtonV2
                                variant="neutral"
                                size="normal"
                                onClick={() => navigate(sessionHref(server.key, schedule.lastSessionId!))}
                              >
                                <Icon name="bubble-5" size="small" />
                                Ver Chat / Execução
                              </ButtonV2>
                            </Show>
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
                        </div>

                        <Show when={schedule.lastRunAt || schedule.lastError}>
                          <div class="flex items-center gap-3 pt-2 border-t border-v2-border-border-base text-11-regular flex-wrap">
                            <Show when={schedule.lastRunAt}>
                              <span class="text-v2-text-text-faint">
                                Última execução: {new Date(schedule.lastRunAt!).toLocaleString()}
                              </span>
                            </Show>
                            <Show when={schedule.lastError}>
                              <span class="truncate text-v2-state-fg-danger font-mono">
                                Erro: {schedule.lastError}
                              </span>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
