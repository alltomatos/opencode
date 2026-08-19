import { createResource, For, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { DialogMcpAddV2 } from "./dialog-mcp-v2"
import "./settings-v2.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

export const SettingsMcpV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const dialog = useDialog()

  const [status, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.mcp.status()
    return Object.entries(result.data ?? {})
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const toggleMutation = useMutation(() => ({
    mutationFn: async (input: { name: string; connect: boolean }) => {
      if (input.connect) await serverSDK().client.mcp.connect({ name: input.name })
      else await serverSDK().client.mcp.disconnect({ name: input.name })
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const openAdd = () => {
    dialog.push(() => <DialogMcpAddV2 onAdded={() => void refetch()} />)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.mcp.title")}</h2>
          <ButtonV2 variant="neutral" icon="plus" onClick={openAdd}>
            {language.t("settings.mcp.add.button")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-models">
        <Show
          when={!status.loading}
          fallback={
            <div class="settings-v2-models-status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show
            when={(status() ?? []).length > 0}
            fallback={<div class="settings-v2-models-status">{language.t("dialog.mcp.empty")}</div>}
          >
            <SettingsListV2>
              <For each={status()}>
                {(item) => {
                  const statusKey = () => statusLabels[item.status as keyof typeof statusLabels]
                  const error = () => ("error" in item ? item.error : undefined)
                  const connected = () => item.status === "connected"
                  const pending = () => toggleMutation.isPending && toggleMutation.variables?.name === item.name
                  return (
                    <SettingsRowV2
                      title={
                        <span class="flex items-center gap-2">
                          <Icon name="link" class="size-3.5 shrink-0 text-text-weak" />
                          {item.name}
                        </span>
                      }
                      description={
                        <div class="flex min-w-0 items-center gap-2">
                          <Show when={statusKey()}>
                            <Tag>{language.t(statusKey()!)}</Tag>
                          </Show>
                          <Show when={error()}>
                            <span class="truncate">{error()}</span>
                          </Show>
                        </div>
                      }
                    >
                      <SwitchV2
                        checked={connected()}
                        disabled={pending() || item.status === "needs_auth" || item.status === "needs_client_registration"}
                        onChange={(checked) => toggleMutation.mutate({ name: item.name, connect: checked })}
                        hideLabel
                      >
                        {item.name}
                      </SwitchV2>
                    </SettingsRowV2>
                  )
                }}
              </For>
            </SettingsListV2>
          </Show>
        </Show>
      </div>
    </>
  )
}
