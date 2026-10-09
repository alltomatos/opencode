import { createEffect, createMemo, createResource, Show, type Accessor, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
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

const intervalOptions = [
  { value: 1, labelKey: "settings.memory.interval.1h" as const },
  { value: 2, labelKey: "settings.memory.interval.2h" as const },
  { value: 6, labelKey: "settings.memory.interval.6h" as const },
  { value: 12, labelKey: "settings.memory.interval.12h" as const },
  { value: 24, labelKey: "settings.memory.interval.24h" as const },
]

const maxAgeOptions = [
  { value: 7, labelKey: "settings.memory.age.7d" as const },
  { value: 15, labelKey: "settings.memory.age.15d" as const },
  { value: 30, labelKey: "settings.memory.age.30d" as const },
  { value: 60, labelKey: "settings.memory.age.60d" as const },
  { value: 90, labelKey: "settings.memory.age.90d" as const },
]

export const SettingsMemoryV2: Component<{
  directory?: Accessor<string | undefined>
}> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const providers = useProviders(() => props.directory?.())

  const [config, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.memory.getConfig()
    return result.data ?? {}
  })

  const [form, setForm] = createStore({
    memoryModel: "",
    syncIntervalHours: 6,
    maxSessionAgeDays: 30,
  })

  createEffect(() => {
    const data = config()
    if (!data) return
    setForm("memoryModel", data.memoryModel ?? "")
    setForm("syncIntervalHours", typeof data.syncIntervalHours === "number" ? data.syncIntervalHours : 6)
    setForm("maxSessionAgeDays", typeof data.maxSessionAgeDays === "number" ? data.maxSessionAgeDays : 30)
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const payload = {
        enabled: config()?.enabled,
        autoSync: config()?.autoSync,
        syncIntervalHours: form.syncIntervalHours,
        maxSessionAgeDays: form.maxSessionAgeDays,
        memoryModel: form.memoryModel || undefined,
      }
      await serverSDK().client.memory.setConfig({ memoryConfig: payload })
      return payload
    },
    onSuccess: (saved) => {
      void refetch()
      if (saved.memoryModel !== undefined) {
        setForm("memoryModel", saved.memoryModel ?? "")
      }
      if (saved.syncIntervalHours !== undefined) {
        setForm("syncIntervalHours", saved.syncIntervalHours ?? 6)
      }
      if (saved.maxSessionAgeDays !== undefined) {
        setForm("maxSessionAgeDays", saved.maxSessionAgeDays ?? 30)
      }
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.memory.toast.saved") })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const enabledMutation = useMutation(() => ({
    mutationFn: async (enabled: boolean) => {
      const current = config() ?? {}
      await serverSDK().client.memory.setConfig({
        memoryConfig: {
          enabled,
          memoryModel: current.memoryModel,
          autoSync: current.autoSync,
          syncIntervalHours: form.syncIntervalHours,
          maxSessionAgeDays: form.maxSessionAgeDays,
        },
      })
      return enabled
    },
    onSuccess: () => {
      void refetch()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const autoSyncMutation = useMutation(() => ({
    mutationFn: async (autoSync: boolean) => {
      const current = config() ?? {}
      await serverSDK().client.memory.setConfig({
        memoryConfig: {
          enabled: current.enabled,
          memoryModel: current.memoryModel,
          autoSync,
          syncIntervalHours: form.syncIntervalHours,
          maxSessionAgeDays: form.maxSessionAgeDays,
        },
      })
      return autoSync
    },
    onSuccess: () => {
      void refetch()
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
                <Switch
                  checked={config()?.enabled ?? true}
                  disabled={enabledMutation.isPending}
                  onChange={(checked) => enabledMutation.mutate(checked)}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.autoSync.title")}
              description={language.t("settings.memory.field.autoSync.description")}
            >
              <div data-action="settings-memory-autosync">
                <Switch
                  checked={config()?.autoSync ?? true}
                  disabled={autoSyncMutation.isPending}
                  onChange={(checked) => autoSyncMutation.mutate(checked)}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.syncInterval.title")}
              description={language.t("settings.memory.field.syncInterval.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-memory-interval"
                options={intervalOptions}
                current={intervalOptions.find((opt) => opt.value === form.syncIntervalHours) ?? intervalOptions[2]}
                placement="bottom-end"
                gutter={6}
                value={(option) => String(option.value)}
                label={(option) => language.t(option.labelKey)}
                onSelect={(option) => {
                  if (option) {
                    setForm("syncIntervalHours", option.value)
                    void saveMutation.mutate()
                  }
                }}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.maxAge.title")}
              description={language.t("settings.memory.field.maxAge.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-memory-maxage"
                options={maxAgeOptions}
                current={maxAgeOptions.find((opt) => opt.value === form.maxSessionAgeDays) ?? maxAgeOptions[2]}
                placement="bottom-end"
                gutter={6}
                value={(option) => String(option.value)}
                label={(option) => language.t(option.labelKey)}
                onSelect={(option) => {
                  if (option) {
                    setForm("maxSessionAgeDays", option.value)
                    void saveMutation.mutate()
                  }
                }}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.memory.field.memoryModel.title")}
              description={language.t("settings.memory.field.memoryModel.description")}
            >
              <div class="w-full sm:w-[280px]">
                <ModelPickerV2
                  value={form.memoryModel}
                  onChange={(value) => setForm("memoryModel", value)}
                  directory={props.directory?.()}
                />
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}
