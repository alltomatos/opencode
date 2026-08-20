import { createMemo, createResource, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { ModelPickerV2, nativeSelectChevronStyle, nativeSelectClassV2 } from "@/components/model-picker-v2"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsBreniacV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const providers = useProviders(() => undefined)

  const providerList = createMemo(() =>
    Array.from(providers.all().values()).sort((a, b) => a.name.localeCompare(b.name)),
  )

  const [config, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.breniac.getConfig()
    return result.data ?? {}
  })

  const [form, setForm] = createStore({
    providerID: "",
    audioModel: "",
    transcriptionModel: "",
    memoryModel: "",
  })

  createMemo(() => {
    const data = config()
    if (!data) return
    setForm({
      providerID: data.providerID ?? "",
      audioModel: data.audioModel ?? "",
      transcriptionModel: data.transcriptionModel ?? "",
      memoryModel: data.memoryModel ?? "",
    })
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const payload = {
        providerID: form.providerID || undefined,
        audioModel: form.audioModel || undefined,
        transcriptionModel: form.transcriptionModel || undefined,
        memoryModel: form.memoryModel || undefined,
      }
      await serverSDK().client.breniac.setConfig({ breniacConfig: payload })
      return payload
    },
    onSuccess: () => {
      void refetch()
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.breniac.toast.saved") })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">{language.t("settings.breniac.title")}</h2>
          <ButtonV2 variant="contrast" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <Show
          when={!config.loading}
          fallback={<div class="settings-v2-models-status">{language.t("common.loading")}</div>}
        >
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.breniac.field.provider.title")}
              description={language.t("settings.breniac.field.provider.description")}
            >
              <div style={nativeSelectChevronStyle}>
                <select
                  class={nativeSelectClassV2}
                  value={form.providerID}
                  onChange={(event) => setForm("providerID", event.currentTarget.value)}
                >
                  <option value="">{language.t("modelPicker.provider.placeholder")}</option>
                  {providerList().map((provider) => (
                    <option value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.breniac.field.audioModel.title")}
              description={language.t("settings.breniac.field.audioModel.description")}
            >
              <ModelPickerV2 value={form.audioModel} onChange={(value) => setForm("audioModel", value)} />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.breniac.field.transcriptionModel.title")}
              description={language.t("settings.breniac.field.transcriptionModel.description")}
            >
              <ModelPickerV2
                value={form.transcriptionModel}
                onChange={(value) => setForm("transcriptionModel", value)}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.breniac.field.memoryModel.title")}
              description={language.t("settings.breniac.field.memoryModel.description")}
            >
              <ModelPickerV2 value={form.memoryModel} onChange={(value) => setForm("memoryModel", value)} />
            </SettingsRowV2>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}
