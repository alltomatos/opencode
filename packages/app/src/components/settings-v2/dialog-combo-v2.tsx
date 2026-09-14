import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import "./settings-v2.css"

type ComboModel = { model: string; priority: number }
type ComboForm = {
  id: string
  name: string
  models: ComboModel[]
  failoverEnabled: boolean
  failoverStrategy: "priority" | "round-robin"
  requestsPerMinute: string
  tokensPerMinute: string
}

export const DialogComboV2: Component<{
  mode: "add" | "edit"
  combo?: ComboForm
  onSaved: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [form, setForm] = createStore<ComboForm>(
    props.combo ?? {
      id: crypto.randomUUID(),
      name: "",
      models: [{ model: "", priority: 0 }],
      failoverEnabled: true,
      failoverStrategy: "priority",
      requestsPerMinute: "",
      tokensPerMinute: "",
    },
  )

  const addModelRow = () => setForm("models", (models) => [...models, { model: "", priority: models.length }])
  const removeModelRow = (index: number) => setForm("models", (models) => models.filter((_, i) => i !== index))

  const save = async () => {
    if (!form.name.trim() || form.models.some((m) => !m.model)) {
      showToast({ title: language.t("settings.combos.error.incomplete") })
      return
    }
    try {
      await serverSDK().client.combo.add({
        combo: {
          id: form.id,
          name: form.name,
          models: form.models,
          failover: { enabled: form.failoverEnabled, strategy: form.failoverStrategy },
          rateLimit: {
            requestsPerMinute: form.requestsPerMinute ? Number(form.requestsPerMinute) : undefined,
            tokensPerMinute: form.tokensPerMinute ? Number(form.tokensPerMinute) : undefined,
          },
        },
      })
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.combos.toast.saved") })
      props.onSaved()
      dialog.close()
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader>
        <DialogTitle>
          {props.mode === "add" ? language.t("settings.combos.dialog.addTitle") : language.t("settings.combos.dialog.editTitle")}
        </DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2">
        <div class="flex flex-col gap-1.5">
          <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.name")}</label>
          <TextInputV2 value={form.name} onInput={(event) => setForm("name", event.currentTarget.value)} />
        </div>

        <div class="flex flex-col gap-2">
          <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.models")}</label>
          <For each={form.models}>
            {(row, index) => (
              <div class="flex items-center gap-2">
                <ModelPickerV2 value={row.model} onChange={(value) => setForm("models", index(), "model", value)} />
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="xmark-small" />}
                  aria-label={language.t("common.remove")}
                  disabled={form.models.length <= 1}
                  onClick={() => removeModelRow(index())}
                />
              </div>
            )}
          </For>
          <ButtonV2 variant="outline" onClick={addModelRow}>
            {language.t("settings.combos.addModel")}
          </ButtonV2>
        </div>

        <div class="flex items-center justify-between">
          <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.failover")}</label>
          <Switch checked={form.failoverEnabled} onChange={(checked) => setForm("failoverEnabled", checked)} />
        </div>
        <Show when={form.failoverEnabled}>
          <div class="flex flex-col gap-1.5">
            <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.failoverStrategy")}</label>
            <select
              class="h-8 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 text-13-regular"
              value={form.failoverStrategy}
              onChange={(event) => setForm("failoverStrategy", event.currentTarget.value as "priority" | "round-robin")}
            >
              <option value="priority">{language.t("settings.combos.failover.priority")}</option>
              <option value="round-robin">{language.t("settings.combos.failover.roundRobin")}</option>
            </select>
          </div>
        </Show>

        <div class="flex gap-3">
          <div class="flex flex-1 flex-col gap-1.5">
            <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.requestsPerMinute")}</label>
            <TextInputV2
              type="number"
              value={form.requestsPerMinute}
              onInput={(event) => setForm("requestsPerMinute", event.currentTarget.value)}
            />
          </div>
          <div class="flex flex-1 flex-col gap-1.5">
            <label class="settings-v2-server-dialog-label">{language.t("settings.combos.field.tokensPerMinute")}</label>
            <TextInputV2
              type="number"
              value={form.tokensPerMinute}
              onInput={(event) => setForm("tokensPerMinute", event.currentTarget.value)}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={() => void save()}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
