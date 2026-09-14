import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createResource, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { DialogComboV2 } from "./dialog-combo-v2"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const SettingsCombosV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const dialog = useDialog()

  const [combos, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.combo.list()
    return result.data ?? []
  })

  const openAdd = () => {
    dialog.push(() => <DialogComboV2 mode="add" onSaved={() => void refetch()} />)
  }

  const openEdit = (combo: NonNullable<ReturnType<typeof combos>>[number]) => {
    dialog.push(() => (
      <DialogComboV2
        mode="edit"
        combo={{
          id: combo.id,
          name: combo.name,
          models: combo.models.map((m) => ({ model: m.model, priority: Number(m.priority) })),
          failoverEnabled: combo.failover.enabled,
          failoverStrategy: combo.failover.strategy,
          requestsPerMinute: combo.rateLimit?.requestsPerMinute?.toString() ?? "",
          tokensPerMinute: combo.rateLimit?.tokensPerMinute?.toString() ?? "",
        }}
        onSaved={() => void refetch()}
      />
    ))
  }

  const remove = async (id: string) => {
    try {
      await serverSDK().client.combo.remove({ id })
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
          <h2 class="settings-v2-tab-title">{language.t("settings.combos.title")}</h2>
          <ButtonV2 variant="contrast" onClick={openAdd}>
            {language.t("settings.combos.add.button")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-servers">
        <Show
          when={!combos.loading && (combos()?.length ?? 0) > 0}
          fallback={<div class="settings-v2-servers-status">{language.t("settings.combos.empty")}</div>}
        >
          <SettingsListV2>
            <For each={combos()}>
              {(combo) => (
                <div class="settings-v2-servers-row">
                  <div class="settings-v2-servers-lead">
                    <div class="settings-v2-servers-copy">
                      <span class="settings-v2-servers-name">{combo.name}</span>
                      <span class="settings-v2-servers-meta">
                        {language.t("settings.combos.modelCount", { count: combo.models.length })}
                      </span>
                    </div>
                  </div>
                  <div class="settings-v2-servers-actions">
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="edit" />}
                      aria-label={language.t("dialog.server.menu.edit")}
                      onClick={() => openEdit(combo)}
                    />
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="xmark-small" />}
                      aria-label={language.t("dialog.server.menu.delete")}
                      onClick={() => void remove(combo.id)}
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
