import { createMemo, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { BatutaActivity, BatutaWorker } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { ModelPickerV2 } from "./model-picker-v2"
import "../settings-v2/settings-v2.css"

type WorkerRow = BatutaWorker

function newId() {
  return crypto.randomUUID()
}

function emptyWorker(): WorkerRow {
  return { id: newId(), label: "", model: "" }
}

export const DialogBatutaActivityV2: Component<{
  existing?: BatutaActivity
  onSaved?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const isEdit = !!props.existing

  const [form, setForm] = createStore({
    name: props.existing?.name ?? "",
    goal: props.existing?.goal ?? "",
    orchestratorModel: props.existing?.orchestratorModel ?? "",
    workers: props.existing?.workers.length ? props.existing.workers.map((w) => ({ ...w })) : [emptyWorker()],
    useWorktree: props.existing?.useWorktree ?? false,
    err: {} as { name?: string; goal?: string; orchestratorModel?: string; workers?: string },
  })

  const setWorker = (index: number, patch: Partial<WorkerRow>) => {
    setForm("workers", index, patch)
  }
  const addWorker = () => setForm("workers", form.workers.length, emptyWorker())
  const removeWorker = (index: number) => {
    const next = form.workers.filter((_, i) => i !== index)
    setForm("workers", next.length ? next : [emptyWorker()])
  }

  const validate = () => {
    const name = form.name.trim()
    const goal = form.goal.trim()
    const workers = form.workers
      .map((w) => ({ ...w, label: w.label.trim() }))
      .filter((w) => w.label && w.model)
    const err = {
      name: !name ? language.t("provider.custom.error.required") : undefined,
      goal: !goal ? language.t("provider.custom.error.required") : undefined,
      orchestratorModel: !form.orchestratorModel ? language.t("provider.custom.error.required") : undefined,
      workers: workers.length === 0 ? language.t("batuta.form.workers.error.required") : undefined,
    }
    setForm("err", err)
    if (err.name || err.goal || err.orchestratorModel || err.workers) return
    const activity: BatutaActivity = {
      id: props.existing?.id ?? newId(),
      name,
      goal,
      orchestratorModel: form.orchestratorModel,
      workers,
      useWorktree: form.useWorktree,
    }
    return activity
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (activity: BatutaActivity) => {
      await serverSDK().client.batuta.add({ batutaActivity: activity })
      return activity
    },
    onSuccess: (activity) => {
      dialog.close()
      props.onSaved?.()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(isEdit ? "batuta.form.toast.updated" : "batuta.form.toast.created", { name: activity.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const submit = () => {
    if (saveMutation.isPending) return
    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  const title = createMemo(() =>
    isEdit ? language.t("batuta.form.title.edit") : language.t("batuta.form.title.create"),
  )

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[70vh]">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.name.label")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.name}
              placeholder={language.t("batuta.form.field.name.placeholder")}
              invalid={!!form.err.name}
              autofocus={!isEdit}
              onInput={(event) => setForm("name", event.currentTarget.value)}
            />
            <Show when={form.err.name}>
              <span class="settings-v2-server-dialog-error">{form.err.name}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.goal.label")}</label>
            <TextareaV2
              class="!w-full self-stretch"
              rows={3}
              value={form.goal}
              placeholder={language.t("batuta.form.field.goal.placeholder")}
              invalid={!!form.err.goal}
              onInput={(event) => setForm("goal", event.currentTarget.value)}
            />
            <Show when={form.err.goal}>
              <span class="settings-v2-server-dialog-error">{form.err.goal}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.orchestrator.label")}</label>
            <ModelPickerV2 value={form.orchestratorModel} onChange={(value) => setForm("orchestratorModel", value)} />
            <Show when={form.err.orchestratorModel}>
              <span class="settings-v2-server-dialog-error">{form.err.orchestratorModel}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.workers.label")}</label>
            <div class="flex flex-col gap-2">
              <For each={form.workers}>
                {(worker, index) => (
                  <div class="flex items-center gap-1.5 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1.5">
                    <TextInputV2
                      type="text"
                      class="!w-[140px] shrink-0"
                      value={worker.label}
                      placeholder={language.t("batuta.form.field.workers.label.placeholder")}
                      onInput={(event) => setWorker(index(), { label: event.currentTarget.value })}
                    />
                    <ModelPickerV2 value={worker.model} onChange={(value) => setWorker(index(), { model: value })} />
                    <ButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="normal"
                      aria-label={language.t("common.remove")}
                      onClick={() => removeWorker(index())}
                    >
                      <Icon name="close" size="small" />
                    </ButtonV2>
                  </div>
                )}
              </For>
            </div>
            <ButtonV2 type="button" variant="neutral" size="normal" class="self-start" onClick={addWorker}>
              <Icon name="plus" size="small" />
              {language.t("batuta.form.field.workers.add")}
            </ButtonV2>
            <Show when={form.err.workers}>
              <span class="settings-v2-server-dialog-error">{form.err.workers}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2.5">
            <div class="flex min-w-0 flex-col gap-0.5">
              <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.worktree.label")}</label>
              <span class="text-12-regular text-v2-text-text-muted">{language.t("batuta.form.field.worktree.description")}</span>
            </div>
            <SwitchV2 checked={form.useWorktree} onChange={(checked) => setForm("useWorktree", checked)} hideLabel>
              {language.t("batuta.form.field.worktree.label")}
            </SwitchV2>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={saveMutation.isPending} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={saveMutation.isPending} onClick={submit}>
          {saveMutation.isPending
            ? language.t("common.saving")
            : isEdit
              ? language.t("common.save")
              : language.t("batuta.form.submit.create")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
