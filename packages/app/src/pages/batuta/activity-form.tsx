import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import type { BatutaActivity, BatutaWorker } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useDirectoryPicker } from "@/components/directory-picker"
import { showToast } from "@/utils/toast"
import { pathKey } from "@/utils/path-key"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import {
  createPromptProjectController,
  PromptProjectSelector,
  type PromptProjectControls,
} from "@/components/prompt-project-selector"
import "@/components/settings-v2/settings-v2.css"

type WorkerRow = BatutaWorker

function newId() {
  return crypto.randomUUID()
}

function emptyWorker(): WorkerRow {
  return { id: newId(), label: "", model: "" }
}

function createBatutaProjectControls(directory: () => string, setDirectory: (value: string) => void) {
  const server = useServer()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const language = useLanguage()

  const projects = createMemo(() => {
    if (server.list.length <= 1) {
      const conn = server.list[0]
      if (!conn) return []
      return global
        .ensureServerCtx(conn)
        .projects.list()
        .map((project) => ({ ...project, server: undefined as { key: string; name: string } | undefined }))
    }
    return server.list.flatMap((conn) => {
      const item = { key: ServerConnection.key(conn), name: serverName(conn) }
      return global.ensureServerCtx(conn).projects.list().map((project) => ({ ...project, server: item }))
    })
  })

  const currentServerKey = createMemo(() => {
    const dir = directory()
    if (!dir) return undefined
    return projects().find((project) => pathKey(project.worktree) === pathKey(dir))?.server?.key
  })

  const selectProject = (worktree: string) => setDirectory(worktree)

  const addProject = (title: string, serverKey?: string) => {
    const conn = serverKey
      ? server.list.find((item) => ServerConnection.key(item) === serverKey)
      : server.list[0]
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        ctx.projects.open(directory)
        ctx.projects.touch(directory)
        setDirectory(directory)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    directory: directory(),
    server: server.list.length > 1 ? currentServerKey() : undefined,
    select: selectProject,
    add: addProject,
  }))
}

export function BatutaActivityFormPage() {
  const navigate = useNavigate()
  const params = useParams<{ id?: string }>()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const isEdit = !!params.id

  const [activities] = createResource(async () => {
    const result = await serverSDK().client.batuta.list()
    return result.data ?? []
  })
  const existing = createMemo(() => (isEdit ? activities()?.find((item) => item.id === params.id) : undefined))
  const ready = createMemo(() => !isEdit || activities.state === "ready")

  const [form, setForm] = createStore({
    name: "",
    goal: "",
    orchestratorModel: "",
    workers: [emptyWorker()] as WorkerRow[],
    directory: "",
    branch: "",
    err: {} as { name?: string; goal?: string; orchestratorModel?: string; workers?: string; directory?: string },
  })
  let initialized = false
  let branchTouched = false

  createEffect(() => {
    const activity = existing()
    if (!activity || initialized) return
    initialized = true
    branchTouched = true
    setForm({
      name: activity.name,
      goal: activity.goal,
      orchestratorModel: activity.orchestratorModel,
      workers: activity.workers.length ? activity.workers.map((w) => ({ ...w })) : [emptyWorker()],
      directory: activity.directory ?? "",
      branch: activity.branch ?? "",
    })
  })

  const [directory, setDirectory] = createSignal("")
  createEffect(() => setDirectory(form.directory))
  const projectControls = createBatutaProjectControls(directory, (value) => setForm("directory", value))
  const project = createPromptProjectController({ controls: projectControls, onDone: () => {} })

  // List the directory's local branches as soon as it's picked, so the field
  // starts prefilled with the current one — creating a new branch is an
  // explicit action, not just typing over what's already there.
  const [branches] = createResource(directory, async (dir) => {
    if (!dir || isEdit) return undefined
    const result = await serverSDK().client.batuta.branches({ directory: dir })
    return result.data
  })
  createEffect(() => {
    const detected = branches()?.current
    if (!detected || branchTouched) return
    setForm("branch", detected)
  })

  const [creatingBranch, setCreatingBranch] = createSignal(false)
  const [newBranchName, setNewBranchName] = createSignal("")
  const confirmNewBranch = () => {
    const name = newBranchName().trim()
    if (!name) return
    branchTouched = true
    setForm("branch", name)
    setCreatingBranch(false)
    setNewBranchName("")
  }

  const setWorker = (index: number, patch: Partial<WorkerRow>) => setForm("workers", index, patch)
  const addWorker = () => setForm("workers", form.workers.length, emptyWorker())
  const removeWorker = (index: number) => {
    const next = form.workers.filter((_, i) => i !== index)
    setForm("workers", next.length ? next : [emptyWorker()])
  }

  const validate = () => {
    const name = form.name.trim()
    const goal = form.goal.trim()
    const workers = form.workers.map((w) => ({ ...w, label: w.label.trim() })).filter((w) => w.label && w.model)
    const err = {
      name: !name ? language.t("provider.custom.error.required") : undefined,
      goal: !goal ? language.t("provider.custom.error.required") : undefined,
      orchestratorModel: !form.orchestratorModel ? language.t("provider.custom.error.required") : undefined,
      workers: workers.length === 0 ? language.t("batuta.form.workers.error.required") : undefined,
      // Locked to a read-only display once editing, so a legacy activity created
      // before this field existed can still be saved without a directory.
      directory: !isEdit && !form.directory ? language.t("batuta.form.field.directory.error.required") : undefined,
    }
    setForm("err", err)
    if (err.name || err.goal || err.orchestratorModel || err.workers || err.directory) return
    const activity: BatutaActivity = {
      id: existing()?.id ?? newId(),
      name,
      goal,
      orchestratorModel: form.orchestratorModel,
      workers,
      useWorktree: true,
      directory: form.directory,
      branch: form.branch.trim() || undefined,
    }
    return activity
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (activity: BatutaActivity) => {
      await serverSDK().client.batuta.add({ batutaActivity: activity, directory: activity.directory })
      return activity
    },
    onSuccess: (activity) => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(isEdit ? "batuta.form.toast.updated" : "batuta.form.toast.created", { name: activity.name }),
      })
      navigate("/batuta")
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
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3">
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="arrow-left" />}
          aria-label={language.t("common.goBack")}
          onClick={() => navigate("/batuta")}
        />
        <span class="flex-1 text-13-medium text-v2-text-text-base">{title()}</span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="close" />}
          aria-label={language.t("common.close")}
          onClick={() => navigate("/batuta")}
        />
      </div>
      <Show when={ready()} fallback={<div class="flex-1" />}>
        <ScrollView class="h-full">
          <div class="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-3 py-8 lg:px-6">
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.directory.label")}</label>
              <p class="text-12-regular text-v2-text-text-muted">
                {language.t("batuta.form.field.directory.description")}
              </p>
              <Show
                when={!isEdit}
                fallback={
                  <div class="flex h-9 items-center rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 text-13-medium text-v2-text-text-muted">
                    {form.directory}
                  </div>
                }
              >
                <PromptProjectSelector controller={project} placement="bottom-start" />
              </Show>
              <Show when={form.err.directory}>
                <span class="settings-v2-server-dialog-error">{form.err.directory}</span>
              </Show>
            </div>

            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("batuta.form.field.branch.label")}</label>
              <p class="text-12-regular text-v2-text-text-muted">
                {language.t("batuta.form.field.branch.description")}
              </p>
              <Show
                when={!isEdit}
                fallback={
                  <div class="flex h-9 items-center rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 text-13-medium text-v2-text-text-muted">
                    {form.branch || "—"}
                  </div>
                }
              >
                <Show
                  when={!creatingBranch()}
                  fallback={
                    <div class="flex items-center gap-1.5">
                      <TextInputV2
                        type="text"
                        appearance="large"
                        class="!w-full self-stretch"
                        value={newBranchName()}
                        placeholder={language.t("batuta.form.field.branch.newPlaceholder")}
                        autofocus
                        onInput={(event) => setNewBranchName(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") confirmNewBranch()
                          if (event.key === "Escape") setCreatingBranch(false)
                        }}
                      />
                      <ButtonV2 type="button" variant="contrast" size="normal" onClick={confirmNewBranch}>
                        {language.t("common.confirm")}
                      </ButtonV2>
                      <ButtonV2 type="button" variant="neutral" size="normal" onClick={() => setCreatingBranch(false)}>
                        {language.t("common.cancel")}
                      </ButtonV2>
                    </div>
                  }
                >
                  <div class="flex items-center gap-1.5">
                    <SelectV2
                      class="!w-full"
                      appearance="large"
                      options={branches()?.branches ?? (form.branch ? [form.branch] : [])}
                      current={form.branch || undefined}
                      placeholder={
                        branches.loading ? language.t("common.loading") : language.t("batuta.form.field.branch.placeholder")
                      }
                      onSelect={(value) => {
                        if (!value) return
                        branchTouched = true
                        setForm("branch", value)
                      }}
                    />
                    <ButtonV2
                      type="button"
                      variant="neutral"
                      size="normal"
                      class="shrink-0"
                      onClick={() => {
                        setNewBranchName("")
                        setCreatingBranch(true)
                      }}
                    >
                      <IconV2 name="plus" size="small" />
                      {language.t("batuta.form.field.branch.create")}
                    </ButtonV2>
                  </div>
                </Show>
              </Show>
            </div>

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
                        <IconV2 name="close" size="small" />
                      </ButtonV2>
                    </div>
                  )}
                </For>
              </div>
              <ButtonV2 type="button" variant="neutral" size="normal" class="self-start" onClick={addWorker}>
                <IconV2 name="plus" size="small" />
                {language.t("batuta.form.field.workers.add")}
              </ButtonV2>
              <Show when={form.err.workers}>
                <span class="settings-v2-server-dialog-error">{form.err.workers}</span>
              </Show>
            </div>

            <div class="flex w-full min-w-0 items-start gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2.5">
              <Icon name="subagent" class="mt-0.5 size-3.5 shrink-0 text-v2-icon-icon-muted" />
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="settings-v2-server-dialog-label">{language.t("batuta.form.field.worktree.label")}</span>
                <span class="text-12-regular text-v2-text-text-muted">
                  {language.t("batuta.form.field.worktree.description")}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2">
              <ButtonV2 variant="neutral" disabled={saveMutation.isPending} onClick={() => navigate("/batuta")}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2 variant="contrast" disabled={saveMutation.isPending} onClick={submit}>
                {saveMutation.isPending
                  ? language.t("common.saving")
                  : isEdit
                    ? language.t("common.save")
                    : language.t("batuta.form.submit.create")}
              </ButtonV2>
            </div>
          </div>
        </ScrollView>
      </Show>
    </div>
  )
}
