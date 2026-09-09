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

// Brand marks kept as inline monochrome SVGs (currentColor) so no external asset/network
// dependency is introduced just to render a known-connector button.
const LOGOS = {
  cloudflare: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M16.5 15.5c1.5-1.6 1.2-3.2.3-4.2-.8-.9-2-1.2-3.1-.9-.4-1.9-2-3.3-4-3.3-2.2 0-4 1.8-4 4 0 .2 0 .3.1.5C4.2 12 3 13.4 3 15c0 1.9 1.6 3.5 3.5 3.5h9.6c1.6 0 2.9-1.3 2.9-2.9 0-1.1-.6-2-1.5-2.5-.4.9-1 1.6-1 1.4Z" />
    </svg>
  ),
  gmail: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M3 5.5C3 4.7 3.7 4 4.5 4h15c.8 0 1.5.7 1.5 1.5v13c0 .8-.7 1.5-1.5 1.5h-15C3.7 20 3 19.3 3 18.5v-13Zm2 .6v.2l7 5.2 7-5.2v-.2H5Zm14 2.5-6.4 4.8a1 1 0 0 1-1.2 0L5 8.6V18h14V8.6Z" />
    </svg>
  ),
  mercadopago: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.5c1.2 0 2.2.3 2.2 1.5 0 .9-.7 1.3-1.4 1.6l-.5.2c-.6.2-1 .4-1 .9 0 .5.5.8 1.2.8.8 0 1.3-.3 1.6-.6l.9 1.2c-.5.5-1.3.9-2.4 1v1.2h-1.4v-1.2c-1.4-.1-2.4-.8-2.8-1.4l1-1.1c.4.5 1.1 1 2 1 .7 0 1.1-.3 1.1-.8 0-.4-.4-.6-1.1-.9l-.5-.2c-1.1-.4-1.9-.9-1.9-2.1 0-1.2 1-1.9 2.3-2.1V4.3h1.4v1.2Z" />
    </svg>
  ),
  context7: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm10.5 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    </svg>
  ),
  "github-copilot": (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v3c0 .3.2.6.7.5A10 10 0 0 0 22 12c0-5.5-4.5-10-10-10Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  ),
} as const

const KNOWN_SERVERS = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    url: "https://bindings.mcp.cloudflare.com/mcp",
    logo: LOGOS.cloudflare,
    oauth: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    logo: LOGOS.gmail,
    oauth: true,
  },
  {
    id: "mercadopago",
    name: "Mercado Pago",
    url: "https://mcp.mercadopago.com/mcp",
    logo: LOGOS.mercadopago,
    oauth: true,
  },
  {
    id: "context7",
    name: "Context7",
    url: "https://mcp.context7.com/mcp",
    logo: LOGOS.context7,
    oauth: false,
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    url: "https://api.githubcopilot.com/mcp",
    logo: LOGOS["github-copilot"],
    oauth: true,
  },
  {
    id: "facebook-ads",
    name: "Facebook Ads",
    url: "https://graph.facebook.com/mcp",
    logo: LOGOS.facebook,
    oauth: true,
  },
] as const

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
    oauth?: { clientId?: string; clientSecret?: string } | false
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

function existingOAuth(props: { existing?: McpExistingServer }) {
  const oauth = props.existing?.config.oauth
  if (!oauth) return undefined
  return oauth
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
            <div class="flex w-full min-w-0 items-center gap-1.5">
              <TextInputV2
                type="text"
                class="!w-full min-w-0 flex-1"
                value={row.key}
                placeholder="KEY"
                onInput={(e) => setRow(index(), "key", e.currentTarget.value)}
              />
              <TextInputV2
                type="text"
                class="!w-full min-w-0 flex-1"
                value={row.value}
                placeholder="value"
                onInput={(e) => setRow(index(), "value", e.currentTarget.value)}
              />
              <ButtonV2 type="button" variant="ghost-muted" size="normal" class="shrink-0" onClick={() => removeRow(index())}>
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
    oauthClientId: existingOAuth(props)?.clientId ?? "",
    oauthClientSecret: existingOAuth(props)?.clientSecret ?? "",
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
              oauth:
                form.oauthClientId.trim() || form.oauthClientSecret.trim()
                  ? { clientId: form.oauthClientId.trim() || undefined, clientSecret: form.oauthClientSecret.trim() || undefined }
                  : undefined,
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
          <Show when={!isEdit}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.known.label")}</label>
              <div class="grid w-full min-w-0 grid-cols-2 gap-2">
                <For each={KNOWN_SERVERS}>
                  {(server) => (
                    <ButtonV2
                      type="button"
                      variant="neutral"
                      size="normal"
                      class="!w-full !justify-start gap-1.5 overflow-hidden"
                      onClick={() => {
                        setForm("name", server.name)
                        setForm("type", "remote")
                        setForm("url", server.url)
                        setForm("err", {})
                      }}
                    >
                      <span class="shrink-0">{server.logo}</span>
                      <span class="truncate">{server.name}</span>
                      <Show when={server.oauth}>
                        <span class="settings-v2-server-dialog-oauth-badge shrink-0">
                          {language.t("settings.mcp.add.known.oauthBadge")}
                        </span>
                      </Show>
                    </ButtonV2>
                  )}
                </For>
              </div>
              <Show when={KNOWN_SERVERS.some((s) => s.name === form.name && s.oauth)}>
                <span class="settings-v2-server-dialog-hint">{language.t("settings.mcp.add.known.oauthHint")}</span>
              </Show>
            </div>
          </Show>

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
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">
                {language.t("settings.mcp.add.field.oauthClientId.label")}
              </label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.oauthClientId}
                onInput={(event) => setForm("oauthClientId", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">
                {language.t("settings.mcp.add.field.oauthClientSecret.label")}
              </label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                value={form.oauthClientSecret}
                onInput={(event) => setForm("oauthClientSecret", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
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
