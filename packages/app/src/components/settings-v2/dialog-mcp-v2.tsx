import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { type Component, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

type ConnectionType = "local" | "remote"

export const DialogMcpAddV2: Component<{ onAdded?: () => void; prefillName?: string; prefillUrl?: string }> = (
  props,
) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [form, setForm] = createStore({
    name: props.prefillName ?? "",
    type: (props.prefillUrl ? "remote" : "local") as ConnectionType,
    command: "",
    url: props.prefillUrl ?? "",
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
    return {
      name,
      config:
        form.type === "local"
          ? ({ type: "local" as const, command: command.split(/\s+/) } as const)
          : ({ type: "remote" as const, url } as const),
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
        title: language.t("settings.mcp.add.toast.title", { name: input.name }),
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

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("settings.mcp.add.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.mcp.add.field.name.label")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.name}
              placeholder={language.t("settings.mcp.add.field.name.placeholder")}
              invalid={!!form.err.name}
              autofocus
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
                onClick={() => setForm("type", "local")}
              >
                {language.t("settings.mcp.add.type.local")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant={form.type === "remote" ? "contrast" : "neutral"}
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
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={addMutation.isPending} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={addMutation.isPending} onClick={submit}>
          {addMutation.isPending ? language.t("common.saving") : language.t("settings.mcp.add.button")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
