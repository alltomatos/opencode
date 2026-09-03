import { createMemo, createResource, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { OMNIROUTE_PROVIDER_ID } from "@/components/dialog-connect-omniroute"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import { DialogMemoryRecommendedModels } from "./dialog-memory-recommended-models"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsMemoryV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const providers = useProviders(() => undefined)

  const [config, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.memory.getConfig()
    return result.data ?? {}
  })

  const [form, setForm] = createStore({
    enabled: true,
    memoryModel: "",
  })

  createMemo(() => {
    const data = config()
    if (!data) return
    setForm({
      enabled: data.enabled !== false,
      memoryModel: data.memoryModel ?? "",
    })
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const payload = {
        enabled: form.enabled,
        memoryModel: form.memoryModel || undefined,
      }
      await serverSDK().client.memory.setConfig({ memoryConfig: payload })
      return payload
    },
    onSuccess: () => {
      void refetch()
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.memory.toast.saved") })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const omniroute = createMemo(() => providers.all().get(OMNIROUTE_PROVIDER_ID))
  const dialog = useDialog()

  const openRecommendedModels = () => {
    dialog.push(() => (
      <DialogMemoryRecommendedModels
        current={{ memoryModel: form.memoryModel }}
        onApply={(values) => setForm(values)}
      />
    ))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">{language.t("settings.memory.title")}</h2>
          <div class="flex items-center gap-2">
            <Show when={omniroute()}>
              <ButtonV2 variant="outline" onClick={openRecommendedModels}>
                {language.t("settings.memory.quickFill.button")}
              </ButtonV2>
            </Show>
            <ButtonV2 variant="contrast" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
            </ButtonV2>
          </div>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <Show
          when={!config.loading}
          fallback={<div class="settings-v2-models-status">{language.t("common.loading")}</div>}
        >
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.enabled.title")}
              description={language.t("settings.memory.field.enabled.description")}
            >
              <div data-action="settings-memory-enabled">
                <Switch checked={form.enabled} onChange={(checked) => setForm("enabled", checked)} />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.memoryModel.title")}
              description={language.t("settings.memory.field.memoryModel.description")}
            >
              <div class="w-full sm:w-[280px]">
                <ModelPickerV2 value={form.memoryModel} onChange={(value) => setForm("memoryModel", value)} />
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}
