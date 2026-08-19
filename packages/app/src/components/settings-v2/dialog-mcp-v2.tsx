import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { type Component, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

type ConnectionType = "local" | "remote"
type KeyValueRow = { key: string; value: string }

export type McpExistingServer = {
  name: string
  config: {
    type: ConnectionType
    command?: string[]
    cwd?: string
    environment?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    timeout?: number
  }
}

function toRows(record?: Record<string, string>): KeyValueRow[] {
  const entries = Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
  return entries.length ? entries : [{ key: "", value: "" }]
}

function fromRows(rows: KeyValueRow[]): Record<string, string> | undefined {
  const entries = rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value] as const)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function KeyValueEditor(props: { label: string; rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void }) {
  const setRow = (index: number, field: "key" | "value", value: string) => {
    props.onChange(props.rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }
  const removeRow = (index: number) => {
    const next = props.rows.filter((_, i) => i !== index)
    props.onChange(next.length ? next : [{ key: "", value: "" }])
  }
  const addRow = () => props.onChange([...props.rows, { key: "", value: "" }])

  return (
    <div class="flex w-full min-w-0 flex-col gap-2">
      <label class="settings-v2-server-dialog-label">{props.label}</label>
      <div class="flex flex-col gap-1.5">
        <For each={props.rows}>
          {(row, index) => (
            <div class="flex items-center gap-1.5">
              <TextInputV2
                type="text"
                class="!w-full"
                value={row.key}
                placeholder="KEY"
                onInput={(e) => setRow(index(), "key", e.currentTarget.value)}
              />
              <TextInputV2
                type="text"
                class="!w-full"
                value={row.value}
                placeholder="value"
                onInput={(e) => setRow(index(), "value", e.currentTarget.value)}
              />
              <ButtonV2 type="button" variant="ghost-muted" size="normal" onClick={() => removeRow(index())}>
                <Icon name="close" size="small" />
              </ButtonV2>
            </div>
          )}
        </For>
      </div>
      <ButtonV2 type="button" variant="neutral" size="normal" class="self-start" onClick={addRow}>
        <Icon name="plus" size="small" />
        {props.label}
      </ButtonV2>
    </div>
  )
}

export const DialogMcpAddV2: Component<{
  onAdded?: () => void
  prefillName?: string
  prefillUrl?: string
  existing?: McpExistingServer
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const isEdit = !!props.existing

  const [form, setForm] = createStore({
    name: props.existing?.name ?? props.prefillName ?? "",
    type: (props.existing?.config.type ?? (props.prefillUrl ? "remote" : "local")) as ConnectionType,
    command: props.existing?.config.command?.join(" ") ?? "",
    cwd: props.existing?.config.cwd ?? "",
    environment: toRows(props.existing?.config.environment),
    url: props.existing?.config.url ?? props.prefillUrl ?? "",
    headers: toRows(props.existing?.config.headers),
    timeout: props.existing?.config.timeout ? String(props.existing.config.timeout) : "",
    err: {} as { name?: string; command?: string; url?: string },
  })

  const setField = (key: "name" | "command" | "url", value: string) => {
    setForm(key, value)
    setForm("err", key, undefined)
  }

  const validate = () => {
    const name = form.name.trim()
    const command = form.command.trim()
    const url = form.url.trim()
    const err = {
      name: !name ? language.t("provider.custom.error.required") : undefined,
      command: form.type === "local" && !command ? language.t("provider.custom.error.required") : undefined,
      url: form.type === "remote" && !url ? language.t("provider.custom.error.required") : undefined,
    }
    setForm("err", err)
    if (err.name || err.command || err.url) return
    const timeout = form.timeout.trim() ? Number(form.timeout.trim()) : undefined
    return {
      name,
      config:
        form.type === "local"
          ? ({
              type: "local" as const,
              command: command.split(/\s+/),
              cwd: form.cwd.trim() || undefined,
              environment: fromRows(form.environment),
              timeout,
            } as const)
          : ({
              type: "remote" as const,
              url,
              headers: fromRows(form.headers),
              timeout,
            } as const),
    }
  }

  const addMutation = useMutation(() => ({
    mutationFn: async (input: NonNullable<ReturnType<typeof validate>>) => {
      await serverSDK().client.mcp.add({ name: input.name, config: input.config })
      return input
    },
    onSuccess: (input) => {
      dialog.close()
      props.onAdded?.()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(isEdit ? "settings.mcp.edit.toast.title" : "settings.mcp.add.toast.title", {
          name: input.name,
        }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const submit = () => {
    if (addMutation.isPending) return
    const result = validate()
    if (!result) return
    addMutation.mutate(result)
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    submit()
  }

  const title = createMemo(() =>
    isEdit ? language.t("settings.mcp.edit.title") : language.t("settings.mcp.add.title"),
  )

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[60vh]">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.name.label")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.name}
              disabled={isEdit}
              placeholder={language.t("settings.mcp.add.field.name.placeholder")}
              invalid={!!form.err.name}
              autofocus={!isEdit}
              onInput={(event) => setField("name", event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            <Show when={form.err.name}>
              <span class="settings-v2-server-dialog-error">{form.err.name}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.type.label")}</label>
            <div class="flex gap-2">
              <ButtonV2
                type="button"
                variant={form.type === "local" ? "contrast" : "neutral"}
                disabled={isEdit}
                onClick={() => setForm("type", "local")}
              >
                {language.t("settings.mcp.add.type.local")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant={form.type === "remote" ? "contrast" : "neutral"}
                disabled={isEdit}
                onClick={() => setForm("type", "remote")}
              >
                {language.t("settings.mcp.add.type.remote")}
              </ButtonV2>
            </div>
          </div>

          <Show when={form.type === "local"}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">
                {language.t("settings.mcp.add.field.command.label")}
              </label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.command}
                placeholder={language.t("settings.mcp.add.field.command.placeholder")}
                invalid={!!form.err.command}
                onInput={(event) => setField("command", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
              <Show when={form.err.command}>
                <span class="settings-v2-server-dialog-error">{form.err.command}</span>
              </Show>
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.cwd.label")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.cwd}
                placeholder={language.t("settings.mcp.add.field.cwd.placeholder")}
                onInput={(event) => setForm("cwd", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <KeyValueEditor
              label={language.t("settings.mcp.add.field.env.label")}
              rows={form.environment}
              onChange={(rows) => setForm("environment", rows)}
            />
          </Show>

          <Show when={form.type === "remote"}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.url.label")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.url}
                placeholder={language.t("settings.mcp.add.field.url.placeholder")}
                invalid={!!form.err.url}
                onInput={(event) => setField("url", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
              <Show when={form.err.url}>
                <span class="settings-v2-server-dialog-error">{form.err.url}</span>
              </Show>
            </div>
            <KeyValueEditor
              label={language.t("settings.mcp.add.field.headers.label")}
              rows={form.headers}
              onChange={(rows) => setForm("headers", rows)}
            />
          </Show>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.timeout.label")}</label>
            <TextInputV2
              type="text"
              inputmode="numeric"
              appearance="large"
              class="!w-full self-stretch"
              value={form.timeout}
              placeholder={language.t("settings.mcp.add.field.timeout.placeholder")}
              onInput={(event) => setForm("timeout", event.currentTarget.value.replace(/\D/g, ""))}
              onKeyDown={keyDown}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={addMutation.isPending} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={addMutation.isPending} onClick={submit}>
          {addMutation.isPending
            ? language.t("common.saving")
            : isEdit
              ? language.t("common.save")
              : language.t("settings.mcp.add.button")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
