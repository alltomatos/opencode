import { createResource, For, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type DetectedAgent = { id: string; installed: boolean }
type ExternalAgentConfig = { selectedAgents?: string[] }

export const SettingsExternalAgentsV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()

  const [detected, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.externalAgent.detect()
    return (result.data ?? []) as DetectedAgent[]
  })

  const externalAgentConfig = () =>
    (serverSync().data.config as Record<string, unknown>).externalAgent as ExternalAgentConfig | undefined
  const selectedAgents = () => externalAgentConfig()?.selectedAgents

  const isSelected = (id: string) => {
    const selected = selectedAgents()
    return selected === undefined ? true : selected.includes(id)
  }

  const allDetectedIds = () => (detected() ?? []).filter((agent) => agent.installed).map((agent) => agent.id)

  const setSelectedAgents = useMutation(() => ({
    mutationFn: async (input: { selectedAgents: string[] | undefined }) => {
      const config: { externalAgent: ExternalAgentConfig } = {
        externalAgent: { selectedAgents: input.selectedAgents },
      }
      await serverSync().updateConfig(config as Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0])
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  // The toggle IS the confirmation (no extra dialog) — every selection change
  // reconciles the batuta-cli skill on the connected server right away, one
  // write per detected agent, so it stays installed iff detected AND selected.
  const syncSkills = async (nextSelected: string[] | undefined) => {
    const agents = detected() ?? []
    await Promise.all(
      agents.map((agent) => {
        const shouldBeInstalled = agent.installed && (nextSelected === undefined || nextSelected.includes(agent.id))
        return serverSDK().client.externalAgent.setSkill({ id: agent.id, install: shouldBeInstalled })
      }),
    )
  }

  const toggleAll = async (checked: boolean) => {
    const next = checked ? undefined : []
    await setSelectedAgents.mutateAsync({ selectedAgents: next })
    await syncSkills(next)
  }

  const toggleOne = async (id: string, checked: boolean) => {
    const current = selectedAgents() ?? allDetectedIds()
    const next = checked ? Array.from(new Set([...current, id])) : current.filter((agentID) => agentID !== id)
    await setSelectedAgents.mutateAsync({ selectedAgents: next })
    await syncSkills(next)
  }

  const allSelected = () => selectedAgents() === undefined

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">{language.t("settings.externalAgents.title")}</h2>
          <ButtonV2 variant="neutral" onClick={() => void refetch()}>
            {language.t("settings.externalAgents.refresh")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-models">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.externalAgents.selectAll.title")}
              description={language.t("settings.externalAgents.selectAll.description")}
            >
              <SwitchV2
                checked={allSelected()}
                disabled={setSelectedAgents.isPending}
                onChange={(checked) => void toggleAll(checked)}
                hideLabel
              >
                {language.t("settings.externalAgents.selectAll.title")}
              </SwitchV2>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <Show
          when={!detected.loading}
          fallback={
            <div class="settings-v2-models-status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <div class="settings-v2-section">
            <SettingsListV2>
              <For each={detected() ?? []}>
                {(agent) => (
                  <SettingsRowV2
                    title={agent.id}
                    description={
                      agent.installed
                        ? language.t("settings.externalAgents.status.detected")
                        : language.t("settings.externalAgents.status.notDetected")
                    }
                  >
                    <SwitchV2
                      checked={agent.installed && isSelected(agent.id)}
                      disabled={!agent.installed || setSelectedAgents.isPending}
                      onChange={(checked) => void toggleOne(agent.id, checked)}
                      hideLabel
                    >
                      {agent.id}
                    </SwitchV2>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
