import { createMemo, createResource, For, Show, type Accessor, type Component } from "solid-js"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

export const SettingsSkillsV2: Component<{ directory?: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()

  // Scope the skill listing to the active project directory (same discovery
  // context the "/" slash menu uses), falling back to the global instance
  // when Settings is opened with no active project (e.g. from Home).
  const skillApi = createMemo(() => {
    const directory = props.directory?.()
    return directory ? serverSDK().ensureDirSdkContext(directory).api : serverSDK().api
  })

  const [skills, { refetch }] = createResource(skillApi, async (api) => {
    const result = await api.skill.list()
    return result.data.slice().sort((a, b) => a.name.localeCompare(b.name))
  })

  type SkillsConfig = { paths?: string[]; urls?: string[]; claude?: boolean; codex?: boolean }
  const skillsConfig = () => serverSync().data.config.skills as SkillsConfig | undefined
  const claudeEnabled = () => skillsConfig()?.claude !== false
  const codexEnabled = () => skillsConfig()?.codex === true

  const toggleMutation = useMutation(() => ({
    mutationFn: async (input: { claude?: boolean; codex?: boolean }) => {
      const config: { skills: SkillsConfig } = {
        skills: {
          claude: input.claude ?? claudeEnabled(),
          codex: input.codex ?? codexEnabled(),
        },
      }
      await serverSync().updateConfig(config as Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0])
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  type PermissionAction = "ask" | "allow" | "deny"
  type PermissionRule = PermissionAction | Record<string, PermissionAction>
  type PermissionConfig = Record<string, PermissionRule> & { skill?: PermissionRule }

  const permissionConfig = () => serverSync().data.config.permission as PermissionConfig | undefined
  const skillPermission = (name: string): PermissionAction => {
    const rule = permissionConfig()?.skill
    if (rule === undefined) return "allow"
    if (typeof rule === "string") return rule
    return rule[name] ?? rule["*"] ?? "allow"
  }
  const skillEnabled = (name: string) => skillPermission(name) !== "deny"

  const skillToggleMutation = useMutation(() => ({
    mutationFn: async (input: { name: string; enabled: boolean }) => {
      const currentRule = permissionConfig()?.skill
      const currentObject = typeof currentRule === "string" ? { "*": currentRule } : (currentRule ?? {})
      const nextSkillRule: Record<string, PermissionAction> = {
        ...currentObject,
        [input.name]: input.enabled ? "allow" : "deny",
      }
      const config = {
        permission: { ...permissionConfig(), skill: nextSkillRule },
      }
      await serverSync().updateConfig(config as Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0])
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
      </div>
      <div class="settings-v2-tab-body settings-v2-models">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.skills.sources.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.skills.sources.claude.title")}
              description={language.t("settings.skills.sources.claude.description")}
            >
              <SwitchV2
                checked={claudeEnabled()}
                disabled={toggleMutation.isPending}
                onChange={(checked) => toggleMutation.mutate({ claude: checked })}
                hideLabel
              >
                {language.t("settings.skills.sources.claude.title")}
              </SwitchV2>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.skills.sources.codex.title")}
              description={language.t("settings.skills.sources.codex.description")}
            >
              <SwitchV2
                checked={codexEnabled()}
                disabled={toggleMutation.isPending}
                onChange={(checked) => toggleMutation.mutate({ codex: checked })}
                hideLabel
              >
                {language.t("settings.skills.sources.codex.title")}
              </SwitchV2>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.skills.installed.title")}</h3>
          <Show
            when={!skills.loading}
            fallback={
              <div class="settings-v2-models-status">
                {language.t("common.loading")}
                {language.t("common.loading.ellipsis")}
              </div>
            }
          >
            <Show
              when={(skills() ?? []).length > 0}
              fallback={<div class="settings-v2-models-status">{language.t("settings.skills.empty")}</div>}
            >
              <SettingsListV2>
                <For each={skills()}>
                  {(skill) => (
                    <SettingsRowV2 title={skill.name} description={skill.description ?? ""}>
                      <div class="flex items-center gap-3">
                        <span
                          class="settings-v2-provider-env-hint truncate"
                          style={{ "max-width": "220px" }}
                          title={skill.location}
                        >
                          {skill.location}
                        </span>
                        <SwitchV2
                          checked={skillEnabled(skill.name)}
                          disabled={skillToggleMutation.isPending && skillToggleMutation.variables?.name === skill.name}
                          onChange={(checked) => skillToggleMutation.mutate({ name: skill.name, enabled: checked })}
                          hideLabel
                        >
                          {skill.name}
                        </SwitchV2>
                      </div>
                    </SettingsRowV2>
                  )}
                </For>
              </SettingsListV2>
            </Show>
          </Show>
        </div>
      </div>
    </>
  )
}
