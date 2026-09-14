import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { createResource, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { DialogAgentUISandbox } from "./dialog-agentui-sandbox"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const SettingsAgentUIV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const navigate = useNavigate()

  const [agents, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.agentui.list()
    return result.data ?? []
  })

  const remove = async (id: string) => {
    try {
      await serverSDK().client.agentui.remove({ id })
      void refetch()
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  const toggleEnabled = async (agent: NonNullable<ReturnType<typeof agents>>[number]) => {
    try {
      await serverSDK().client.agentui.add({ agentUiAgent: { ...agent, enabled: agent.enabled === false } })
      void refetch()
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  const openSandbox = (agent: NonNullable<ReturnType<typeof agents>>[number]) => {
    dialog.push(() => <DialogAgentUISandbox agentID={agent.id} agentName={agent.name} directory={props.directory} />)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">{language.t("settings.agentui.title")}</h2>
          <ButtonV2 variant="contrast" onClick={() => navigate("/agentui/new")}>
            {language.t("settings.agentui.add.button")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-servers">
        <Show
          when={!agents.loading && (agents()?.length ?? 0) > 0}
          fallback={<div class="settings-v2-servers-status">{language.t("settings.agentui.empty")}</div>}
        >
          <SettingsListV2>
            <For each={agents()}>
              {(agent) => (
                <div class="settings-v2-servers-row">
                  <div class="settings-v2-servers-lead">
                    <div class="settings-v2-servers-copy">
                      <span class="settings-v2-servers-name">{agent.name}</span>
                      <span class="settings-v2-servers-meta">{agent.model}</span>
                    </div>
                  </div>
                  <div class="settings-v2-servers-actions flex items-center gap-1">
                    <TooltipV2
                      placement="top"
                      value={language.t(
                        agent.enabled === false ? "settings.agentui.enable" : "settings.agentui.disable",
                      )}
                    >
                      <Switch checked={agent.enabled !== false} onChange={() => void toggleEnabled(agent)} />
                    </TooltipV2>
                    <ButtonV2 variant="neutral" size="normal" onClick={() => openSandbox(agent)}>
                      {language.t("settings.agentui.sandbox.open")}
                    </ButtonV2>
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="edit" />}
                      aria-label={language.t("dialog.server.menu.edit")}
                      onClick={() => navigate(`/agentui/${agent.id}/edit`)}
                    />
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="xmark-small" />}
                      aria-label={language.t("dialog.server.menu.delete")}
                      onClick={() => void remove(agent.id)}
                    />
                  </div>
                </div>
              )}
            </For>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}
