import { createResource, createSignal, For, Show } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { BatutaActivity } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "@/components/settings-v2/parts/list"
import { SettingsRowV2 } from "@/components/settings-v2/parts/row"
import { DialogBatutaActivityV2 } from "@/components/batuta/dialog-batuta-activity-v2"
import { BatutaActivityPanel2D } from "@/components/batuta/activity-panel-2d"
import { BatutaActivityPanel3D } from "@/components/batuta/activity-panel-3d"
import { detectGpuSupport } from "@/utils/gpu"

const RUNNING_SESSIONS_KEY = "batuta.runningSessions.v1"

function loadRunningSessions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RUNNING_SESSIONS_KEY) ?? "{}")
  } catch {
    return {}
  }
}

export function BatutaPage() {
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [runningSessions, setRunningSessionsSignal] = createSignal<Record<string, string>>(loadRunningSessions())
  const setRunningSessions = (updater: (prev: Record<string, string>) => Record<string, string>) => {
    setRunningSessionsSignal((prev) => {
      const next = updater(prev)
      localStorage.setItem(RUNNING_SESSIONS_KEY, JSON.stringify(next))
      return next
    })
  }

  const [activities, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.batuta.list()
    return result.data ?? []
  })

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      await serverSDK().client.batuta.remove({ id })
      return id
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const startMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const result = await serverSDK().client.batuta.start({ id })
      return { id, sessionID: result.data?.sessionID }
    },
    onSuccess: ({ id, sessionID }) => {
      if (!sessionID) return
      setRunningSessions((prev) => ({ ...prev, [id]: sessionID }))
      navigate(sessionHref(server.key, sessionID))
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const openLivePanel = (activity: BatutaActivity, sessionID: string) => {
    dialog.push(() => (
      <Dialog fit class="settings-v2-server-dialog">
        <DialogHeader hideClose={true}>
          <DialogTitle>{language.t("batuta.panel.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[70vh]">
          <Show
            when={detectGpuSupport()}
            fallback={<BatutaActivityPanel2D orchestratorSessionID={sessionID} activity={activity} />}
          >
            <BatutaActivityPanel3D orchestratorSessionID={sessionID} activity={activity} />
          </Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
  }

  const openCreate = () => {
    dialog.push(() => <DialogBatutaActivityV2 onSaved={() => void refetch()} />)
  }

  const openEdit = (activity: BatutaActivity) => {
    dialog.push(() => <DialogBatutaActivityV2 existing={activity} onSaved={() => void refetch()} />)
  }

  const confirmRemove = (activity: BatutaActivity) => {
    dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose={true}>
          <DialogTitle>{language.t("batuta.remove.confirm.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-2 pb-4">
          <span class="text-13-regular text-text-weak">
            {language.t("batuta.remove.confirm.description", { name: activity.name })}
          </span>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              removeMutation.mutate(activity.id)
            }}
          >
            {language.t("common.remove")}
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
            <div class="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-v2-background-bg-raised text-v2-icon-icon-base">
              <IconV2 name="batuta" size="large" />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <h1 class="text-lg font-medium text-v2-text-text-base">{language.t("batuta.title")}</h1>
              <p class="text-sm leading-relaxed text-v2-text-text-muted">{language.t("batuta.intro")}</p>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-v2-text-text-base">{language.t("batuta.list.title")}</h2>
            <ButtonV2 variant="neutral" onClick={openCreate}>
              <IconV2 name="plus" size="small" />
              {language.t("batuta.list.create")}
            </ButtonV2>
          </div>

          <Show
            when={!activities.loading}
            fallback={<div class="text-sm text-v2-text-text-muted">{language.t("common.loading")}</div>}
          >
            <Show
              when={(activities() ?? []).length > 0}
              fallback={<div class="text-sm text-v2-text-text-muted">{language.t("batuta.list.empty")}</div>}
            >
              <SettingsListV2>
                <For each={activities()}>
                  {(activity) => {
                    const pending = () => startMutation.isPending && startMutation.variables === activity.id
                    return (
                      <SettingsRowV2
                        title={activity.name}
                        description={
                          <div class="flex min-w-0 flex-col gap-1.5">
                            <span class="truncate text-v2-text-text-muted">{activity.goal}</span>
                            <div class="flex flex-wrap items-center gap-1.5">
                              <Tag>{activity.orchestratorModel}</Tag>
                              <For each={activity.workers}>{(worker) => <Tag>{worker.label}</Tag>}</For>
                              <Show when={activity.useWorktree}>
                                <Tag>{language.t("batuta.form.field.worktree.label")}</Tag>
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        <div class="flex items-center gap-1">
                          <Show when={runningSessions()[activity.id]}>
                            {(sessionID) => (
                              <ButtonV2 variant="neutral" size="normal" onClick={() => openLivePanel(activity, sessionID())}>
                                {language.t("batuta.list.viewLive")}
                              </ButtonV2>
                            )}
                          </Show>
                          <IconButtonV2
                            variant="ghost-muted"
                            aria-label={language.t("common.edit")}
                            onClick={() => openEdit(activity)}
                            icon={<IconV2 name="edit" size="small" />}
                          />
                          <IconButtonV2
                            variant="ghost-muted"
                            class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                            aria-label={language.t("common.remove")}
                            onClick={() => confirmRemove(activity)}
                            icon={<IconV2 name="close" size="small" />}
                          />
                          <ButtonV2
                            variant="contrast"
                            size="normal"
                            disabled={pending()}
                            onClick={() => startMutation.mutate(activity.id)}
                          >
                            {pending() ? language.t("common.loading") : language.t("batuta.list.start")}
                          </ButtonV2>
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
