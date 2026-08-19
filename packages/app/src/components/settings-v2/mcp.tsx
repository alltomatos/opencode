import { createMemo, createResource, For, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { DialogMcpAddV2, type McpExistingServer } from "./dialog-mcp-v2"
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
  const serverSync = useServerSync()
  const dialog = useDialog()

  const [status, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.mcp.status()
    return Object.entries(result.data ?? {})
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const configs = createMemo(() => serverSync().data.config.mcp ?? {})

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

  const authMutation = useMutation(() => ({
    mutationFn: async (name: string) => {
      await serverSDK().client.mcp.auth.authenticate({ name })
      return name
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (name: string) => {
      await serverSDK().client.mcp.remove({ name })
      return name
    },
    onSuccess: (name) => {
      void refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.mcp.remove.toast.title", { name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const openAdd = () => {
    dialog.push(() => <DialogMcpAddV2 onAdded={() => void refetch()} />)
  }

  const openEdit = (name: string) => {
    const config = configs()[name]
    if (!config || !("type" in config)) return
    const existing: McpExistingServer = {
      name,
      config: {
        type: config.type,
        command: config.type === "local" ? config.command : undefined,
        cwd: config.type === "local" ? config.cwd : undefined,
        environment: config.type === "local" ? config.environment : undefined,
        url: config.type === "remote" ? config.url : undefined,
        headers: config.type === "remote" ? config.headers : undefined,
        timeout: config.timeout,
        oauth: config.type === "remote" ? config.oauth : undefined,
      },
    }
    dialog.push(() => <DialogMcpAddV2 existing={existing} onAdded={() => void refetch()} />)
  }

  const confirmRemove = (name: string) => {
    dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose={true}>
          <DialogTitle>{language.t("settings.mcp.remove.confirm.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-2 pb-4">
          <span class="text-13-regular text-text-weak">
            {language.t("settings.mcp.remove.confirm.description", { name })}
          </span>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              removeMutation.mutate(name)
            }}
          >
            {language.t("settings.mcp.remove.button")}
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
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
                  const authPending = () => authMutation.isPending && authMutation.variables === item.name
                  const needsAuth = () => item.status === "needs_auth"
                  const needsClientRegistration = () => item.status === "needs_client_registration"
                  return (
                    <SettingsRowV2
                      title={
                        <span class="flex items-center gap-2">
                          <Icon name="link" class="size-3.5 shrink-0 text-text-weak" />
                          {item.name}
                        </span>
                      }
                      description={
                        <div class="flex min-w-0 flex-col gap-1">
                          <div class="flex min-w-0 items-center gap-2">
                            <Show when={statusKey()}>
                              <Tag>{language.t(statusKey()!)}</Tag>
                            </Show>
                            <Show when={error()}>
                              <span class="truncate">{error()}</span>
                            </Show>
                          </div>
                          <Show when={needsClientRegistration()}>
                            <span class="text-12-regular text-text-weak">
                              {language.t("settings.mcp.auth.needsClientRegistration.hint")}
                            </span>
                          </Show>
                        </div>
                      }
                    >
                      <div class="flex items-center gap-1">
                        <IconButtonV2
                          variant="ghost-muted"
                          aria-label={language.t("common.edit")}
                          onClick={() => openEdit(item.name)}
                          icon={<IconV2 name="edit" size="small" />}
                        />
                        <IconButtonV2
                          variant="ghost-muted"
                          class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                          aria-label={language.t("settings.mcp.remove.button")}
                          onClick={() => confirmRemove(item.name)}
                          icon={<Icon name="trash" size="small" />}
                        />
                        <Show
                          when={needsAuth()}
                          fallback={
                            <SwitchV2
                              checked={connected()}
                              disabled={pending() || needsClientRegistration()}
                              onChange={(checked) => toggleMutation.mutate({ name: item.name, connect: checked })}
                              hideLabel
                            >
                              {item.name}
                            </SwitchV2>
                          }
                        >
                          <ButtonV2
                            variant="neutral"
                            size="normal"
                            disabled={authPending()}
                            onClick={() => authMutation.mutate(item.name)}
                          >
                            {authPending()
                              ? language.t("common.loading")
                              : language.t("settings.mcp.auth.connect.button")}
                          </ButtonV2>
                        </Show>
                      </div>
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
