import { createSignal, For, Show, type Component } from "solid-js"
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
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import type { ScheduleInfo } from "@opencode-ai/sdk/v2"
import { sessionHref } from "@/utils/session-route"
import { useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { GlobalLoading } from "@/components/global-loading"
import { triggerSummary, actionSummary } from "./routines/summary"
import { useRoutinesQuery } from "./routines/routines-cache"

const ROUTINES_VIEW_STORAGE_KEY = "routines.view.mode"
type ViewMode = "grid" | "list"

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(ROUTINES_VIEW_STORAGE_KEY)
    return stored === "list" ? "list" : "grid"
  } catch {
    return "grid"
  }
}

function splitModel(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return { providerID: undefined, modelID: value }
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

function ModelTag(props: { value: string }) {
  const parts = () => splitModel(props.value)
  return (
    <Tag class="flex items-center gap-1.5 text-11-medium bg-v2-background-bg-layer-01 border border-v2-border-border-base text-v2-text-text-base" title={props.value}>
      <Show when={parts().providerID}>{(providerID) => <ProviderIcon id={providerID()} class="size-3 shrink-0" />}</Show>
      <span class="truncate max-w-[150px]">{parts().modelID}</span>
    </Tag>
  )
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.5 5.83h9.17M7.5 10h9.17M7.5 14.17h9.17M3.33 5.83h.01M3.33 10h.01M3.33 14.17h.01"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
      />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.33" y="3.33" width="5.83" height="5.83" rx="1.2" stroke="currentColor" stroke-width="1.75" />
      <rect x="10.83" y="3.33" width="5.83" height="5.83" rx="1.2" stroke="currentColor" stroke-width="1.75" />
      <rect x="3.33" y="10.83" width="5.83" height="5.83" rx="1.2" stroke="currentColor" stroke-width="1.75" />
      <rect x="10.83" y="10.83" width="5.83" height="5.83" rx="1.2" stroke="currentColor" stroke-width="1.75" />
    </svg>
  )
}

export const RoutinesPage: Component = () => {
  const server = useServer()
  const navigate = useNavigate()
  const dialog = useDialog()
  const routines = useRoutinesQuery()
  const [viewMode, setViewModeSignal] = createSignal<ViewMode>(loadViewMode())

  const setViewMode = (mode: ViewMode) => {
    setViewModeSignal(mode)
    try {
      localStorage.setItem(ROUTINES_VIEW_STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  const runMutation = useMutation(() => ({
    mutationFn: async (id: string) => routines.scheduleClient()?.run({ scheduleID: id }),
    onSuccess: () => routines.invalidate(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível rodar a rotina", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => routines.scheduleClient()?.remove({ scheduleID: id }),
    onSuccess: () => routines.invalidate(),
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
        <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-8 lg:px-8">
          {/* Header Superior */}
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3.5">
              <div class="flex size-13 shrink-0 items-center justify-center rounded-[12px] bg-v2-background-bg-raised text-v2-icon-icon-base border border-v2-border-border-base shadow-sm">
                <Icon name="task" size="large" class="size-7" />
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <h1 class="text-lg font-semibold text-v2-text-text-base">Rotinas</h1>
                <p class="text-12-regular text-v2-text-text-muted">
                  Automações periódicas com IA, execuções e histórico de sessão.
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2.5">
              {/* Toggle de Visualização (Grid / Lista) */}
              <div class="flex items-center rounded-[7px] bg-v2-background-bg-layer-01 p-0.5 border border-v2-border-border-base">
                <TooltipV2 placement="bottom" value="Visualização em grade">
                  <button
                    type="button"
                    class={`
                      flex size-7 items-center justify-center rounded-[5px] transition-colors cursor-pointer
                      ${
                        viewMode() === "grid"
                          ? "bg-v2-background-bg-base text-v2-text-text-base shadow-sm font-semibold"
                          : "text-v2-text-text-muted hover:text-v2-text-text-base"
                      }
                    `}
                    aria-label="Grade"
                    onClick={() => setViewMode("grid")}
                  >
                    <GridIcon />
                  </button>
                </TooltipV2>
                <TooltipV2 placement="bottom" value="Visualização em lista">
                  <button
                    type="button"
                    class={`
                      flex size-7 items-center justify-center rounded-[5px] transition-colors cursor-pointer
                      ${
                        viewMode() === "list"
                          ? "bg-v2-background-bg-base text-v2-text-text-base shadow-sm font-semibold"
                          : "text-v2-text-text-muted hover:text-v2-text-text-base"
                      }
                    `}
                    aria-label="Lista"
                    onClick={() => setViewMode("list")}
                  >
                    <ListIcon />
                  </button>
                </TooltipV2>
              </div>

              <ButtonV2 variant="contrast" onClick={openCreate}>
                <IconV2 name="plus" size="small" />
                Nova rotina
              </ButtonV2>
            </div>
          </div>

          {/* Subheader com contador */}
          <div class="flex items-center justify-between border-b border-v2-border-border-base pb-2">
            <h2 class="text-13-medium text-v2-text-text-base font-semibold">Suas rotinas ativas</h2>
            <span class="text-11-regular text-text-weak">
              {routines.schedules().length} {routines.schedules().length === 1 ? "rotina cadastrada" : "rotinas cadastradas"}
            </span>
          </div>

          <Show
            when={!routines.loading()}
            fallback={<GlobalLoading size="small" class="py-12" />}
          >
            <Show
              when={routines.schedules().length > 0}
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
              {/* Renderização em Grade ou Lista */}
              <div
                class={
                  viewMode() === "grid"
                    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5"
                    : "flex flex-col gap-3"
                }
              >
                <For each={routines.schedules()}>
                  {(schedule) => {
                    const running = () => runMutation.isPending && runMutation.variables === schedule.id
                    const displayName = () =>
                      schedule.name?.trim() || triggerSummary(schedule.trigger)
                    const hasSession = () => Boolean(schedule.lastSessionId)
                    const modelName = () => (schedule.action as any)?.model

                    return (
                      <div
                        class={`
                          flex flex-col justify-between gap-3 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02
                          transition-all hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-01 shadow-sm
                        `}
                      >
                        <div class="flex flex-col gap-2.5 min-w-0">
                          {/* Cabeçalho do Card */}
                          <div class="flex items-start justify-between gap-2">
                            <div class="flex min-w-0 flex-col gap-1">
                              <span class="font-semibold text-14-medium text-v2-text-text-base truncate" title={displayName()}>
                                {displayName()}
                              </span>
                              <div class="flex items-center gap-1.5 flex-wrap">
                                <Tag class="text-11-medium bg-v2-background-bg-layer-01 border border-v2-border-border-base">
                                  {triggerSummary(schedule.trigger)}
                                </Tag>
                                <Show when={modelName()}>
                                  <ModelTag value={modelName()!} />
                                </Show>
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
                            </div>

                            <IconButtonV2
                              variant="ghost-muted"
                              size="small"
                              class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger shrink-0"
                              aria-label="Remover"
                              onClick={() => confirmRemove(schedule)}
                              icon={<IconV2 name="close" size="small" />}
                            />
                          </div>

                          {/* Descrição e Ação */}
                          <Show when={schedule.description}>
                            <p class="text-12-regular text-text-weak leading-relaxed line-clamp-2">
                              {schedule.description}
                            </p>
                          </Show>
                          <span class="text-12-regular text-v2-text-text-muted line-clamp-2">
                            {actionSummary(schedule.action)}
                          </span>
                        </div>

                        {/* Rodapé do Card com Ações e Metadados */}
                        <div class="flex flex-col gap-2.5 pt-2 border-t border-v2-border-border-base">
                          <Show when={schedule.lastRunAt || schedule.lastError}>
                            <div class="flex items-center gap-2 text-11-regular flex-wrap">
                              <Show when={schedule.lastRunAt}>
                                <span class="text-v2-text-text-faint truncate">
                                  Última execução: {new Date(schedule.lastRunAt!).toLocaleString()}
                                </span>
                              </Show>
                              <Show when={schedule.lastError}>
                                <span class="truncate text-v2-state-fg-danger font-mono" title={schedule.lastError}>
                                  Erro: {schedule.lastError}
                                </span>
                              </Show>
                            </div>
                          </Show>

                          <div class="flex items-center justify-end gap-1.5 flex-wrap">
                            <ButtonV2
                              variant="neutral"
                              size="small"
                              onClick={() => navigate(`/rotinas/${schedule.id}/edit`)}
                            >
                              <Icon name="sliders" size="small" />
                              Editar
                            </ButtonV2>
                            <Show when={hasSession()}>
                              <ButtonV2
                                variant="neutral"
                                size="small"
                                onClick={() => navigate(sessionHref(server.key, schedule.lastSessionId!))}
                              >
                                <Icon name="bubble-5" size="small" />
                                Ver Chat / Execução
                              </ButtonV2>
                            </Show>
                            <ButtonV2
                              variant="contrast"
                              size="small"
                              disabled={running()}
                              onClick={() => runMutation.mutate(schedule.id)}
                            >
                              {running() ? "Rodando…" : "Rodar agora"}
                            </ButtonV2>
                          </div>
                        </div>
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
