import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import "./settings-v2.css"

type RagSource = { id: string; kind: "text" | "url"; label: string; value: string }
type AgentUIForm = {
  id: string
  name: string
  personality: string
  model: string
  commandTriggers: string
  ragSources: RagSource[]
  guardrailsEnabled: boolean
  guardrailsLevel: "basic" | "strict"
  telegram: boolean
}

export const DialogAgentUIV2: Component<{
  mode: "add" | "edit"
  agent?: AgentUIForm
  combos: { id: string; name: string }[]
  onSaved: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [form, setForm] = createStore<AgentUIForm>(
    props.agent ?? {
      id: crypto.randomUUID(),
      name: "",
      personality: "",
      model: "",
      commandTriggers: "!",
      ragSources: [],
      guardrailsEnabled: true,
      guardrailsLevel: "basic",
      telegram: false,
    },
  )

  const addRagSource = () =>
    setForm("ragSources", (list) => [...list, { id: crypto.randomUUID(), kind: "text", label: "", value: "" }])
  const removeRagSource = (id: string) => setForm("ragSources", (list) => list.filter((s) => s.id !== id))

  const save = async () => {
    if (!form.name.trim() || !form.model) {
      showToast({ title: language.t("settings.agentui.error.incomplete") })
      return
    }
    const triggers = form.commandTriggers
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    try {
      await serverSDK().client.agentui.add({
        agentUiAgent: {
          id: form.id,
          name: form.name,
          personality: form.personality,
          model: form.model,
          channels: form.telegram ? [{ type: "telegram" }] : [],
          commandTriggers: triggers,
          ragSources: form.ragSources.filter((s) => s.label && s.value),
          guardrails: { enabled: form.guardrailsEnabled, level: form.guardrailsLevel },
        },
      })
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.agentui.toast.saved") })
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
          {props.mode === "add" ? language.t("settings.agentui.dialog.addTitle") : language.t("settings.agentui.dialog.editTitle")}
        </DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2 overflow-y-auto max-h-[70vh]">
        <div class="flex flex-col gap-1.5">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.name")}</label>
          <TextInputV2 value={form.name} onInput={(event) => setForm("name", event.currentTarget.value)} />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.personality")}</label>
          <TextareaV2
            value={form.personality}
            onInput={(event) => setForm("personality", event.currentTarget.value)}
            rows={4}
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.model")}</label>
          <ModelPickerV2 value={form.model} onChange={(value) => setForm("model", value)} combos={props.combos} />
        </div>

        <div class="flex items-center justify-between">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.telegram")}</label>
          <Switch checked={form.telegram} onChange={(checked) => setForm("telegram", checked)} />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.commandTriggers")}</label>
          <TextInputV2
            value={form.commandTriggers}
            onInput={(event) => setForm("commandTriggers", event.currentTarget.value)}
            placeholder="! #"
          />
        </div>

        <div class="flex items-center justify-between">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.guardrails")}</label>
          <Switch checked={form.guardrailsEnabled} onChange={(checked) => setForm("guardrailsEnabled", checked)} />
        </div>
        <Show when={form.guardrailsEnabled}>
          <div class="flex flex-col gap-1.5">
            <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.guardrailsLevel")}</label>
            <select
              class="h-8 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 text-13-regular"
              value={form.guardrailsLevel}
              onChange={(event) => setForm("guardrailsLevel", event.currentTarget.value as "basic" | "strict")}
            >
              <option value="basic">{language.t("settings.agentui.guardrails.basic")}</option>
              <option value="strict">{language.t("settings.agentui.guardrails.strict")}</option>
            </select>
          </div>
        </Show>

        <div class="flex flex-col gap-2">
          <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.ragSources")}</label>
          <For each={form.ragSources}>
            {(source, index) => (
              <div class="flex items-start gap-2">
                <TextInputV2
                  class="w-[120px]"
                  placeholder={language.t("settings.agentui.rag.label")}
                  value={source.label}
                  onInput={(event) => setForm("ragSources", index(), "label", event.currentTarget.value)}
                />
                <TextInputV2
                  class="flex-1"
                  placeholder={language.t("settings.agentui.rag.value")}
                  value={source.value}
                  onInput={(event) => setForm("ragSources", index(), "value", event.currentTarget.value)}
                />
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="xmark-small" />}
                  aria-label={language.t("common.remove")}
                  onClick={() => removeRagSource(source.id)}
                />
              </div>
            )}
          </For>
          <ButtonV2 variant="outline" onClick={addRagSource}>
            {language.t("settings.agentui.rag.add")}
          </ButtonV2>
          <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.rag.note")}</p>
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
