import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createResource, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { DialogAgentUIV2 } from "./dialog-agentui-v2"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const SettingsAgentUIV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const dialog = useDialog()

  const [agents, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.agentui.list()
    return result.data ?? []
  })
  const [combos] = createResource(async () => {
    const result = await serverSDK().client.combo.list()
    return (result.data ?? []).map((c) => ({ id: c.id, name: c.name }))
  })

  const openAdd = () => {
    dialog.push(() => <DialogAgentUIV2 mode="add" combos={combos() ?? []} onSaved={() => void refetch()} />)
  }

  const openEdit = (agent: NonNullable<ReturnType<typeof agents>>[number]) => {
    dialog.push(() => (
      <DialogAgentUIV2
        mode="edit"
        combos={combos() ?? []}
        agent={{
          id: agent.id,
          name: agent.name,
          personality: agent.personality,
          model: agent.model,
          commandTriggers: agent.commandTriggers.join(" "),
          ragSources: agent.ragSources.map((s) => ({ id: s.id, kind: s.kind as "text" | "url", label: s.label, value: s.value })),
          guardrailsEnabled: agent.guardrails.enabled,
          guardrailsLevel: agent.guardrails.level,
          telegram: agent.channels.some((c) => c.type === "telegram"),
        }}
        onSaved={() => void refetch()}
      />
    ))
  }

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

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">{language.t("settings.agentui.title")}</h2>
          <ButtonV2 variant="contrast" onClick={openAdd}>
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
                  <div class="settings-v2-servers-actions">
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="edit" />}
                      aria-label={language.t("dialog.server.menu.edit")}
                      onClick={() => openEdit(agent)}
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
