import { createMemo, createSignal, startTransition } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "@/components/settings-v2/general"
import { SettingsKeybinds } from "@/components/settings-keybinds"
import { SettingsProvidersV2 } from "@/components/settings-v2/providers"
import { SettingsModelsV2 } from "@/components/settings-v2/models"
import { SettingsServersV2 } from "@/components/settings-v2/servers"
import { SettingsSkillsV2 } from "@/components/settings-v2/skills"
import { SettingsMcpV2 } from "@/components/settings-v2/mcp"
import { SettingsExternalAgentsV2 } from "@/components/settings-v2/external-agents"
import "@/components/settings-v2/settings-v2.css"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { createHomeController } from "@/pages/home/home-controller"

export function SettingsPage() {
  const language = useLanguage()
  const platform = usePlatform()
  const navigate = useNavigate()
  const params = useParams<{ tab?: string }>()
  const [searchParams] = useSearchParams<{ session?: string }>()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const home = createHomeController()
  const [tab, setTab] = createSignal(params.tab || "general")

  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return home.project.selected()?.worktree ?? home.project.newSession()?.worktree
  })
  // The settings route has no session segment of its own — the session
  // that was active when settings were opened travels here as a query
  // param instead (see useSettingsDialog), so the per-session permission
  // toggle stays scoped to it even after navigating off the session URL.
  const sessionID = createMemo(() => searchParams.session)

  const changeTab = (value: string) => {
    void startTransition(() => setTab(value))
    const search = searchParams.session ? `?session=${encodeURIComponent(searchParams.session)}` : ""
    navigate(`/settings/${value}${search}`, { replace: true })
  }

  const showProviders = () => changeTab("providers")

  return (
    <div
      class={`
        settings-v2-page m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="settings-v2-page-header flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3">
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="arrow-left" />}
          aria-label={language.t("common.goBack")}
          onClick={() => navigate(-1)}
        />
        <span class="flex-1 text-13-medium text-v2-text-text-base">{language.t("settings.title")}</span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="close" />}
          aria-label={language.t("common.close")}
          onClick={() => navigate("/")}
        />
      </div>
      <div class="min-h-0 flex-1">
        <TabsV2
          orientation="vertical"
          variant="settings"
          value={tab()}
          onChange={changeTab}
          class="settings-v2 settings-v2-page-tabs"
        >
          <TabsV2.List>
            <div class="flex flex-col justify-between h-full w-full">
              <div class="flex flex-col gap-3 w-full">
                <div class="flex flex-col gap-3">
                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                    <div class="flex flex-col gap-1.5 w-full">
                      <TabsV2.Trigger value="general">
                        <Icon name="sliders" />
                        {language.t("settings.tab.general")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="shortcuts">
                        <Icon name="keyboard" />
                        {language.t("settings.tab.shortcuts")}
                      </TabsV2.Trigger>
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                    <div class="flex flex-col gap-1.5 w-full">
                      <TabsV2.Trigger value="servers">
                        <Icon name="server" />
                        {language.t("status.popover.tab.servers")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="providers">
                        <Icon name="providers" />
                        {language.t("settings.providers.title")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="models">
                        <Icon name="models" />
                        {language.t("settings.models.title")}
                      </TabsV2.Trigger>
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("settings.section.customize")}</TabsV2.SectionTitle>
                    <div class="flex flex-col gap-1.5 w-full">
                      <TabsV2.Trigger value="skills">
                        <Icon name="brain" />
                        {language.t("settings.skills.title")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="mcp">
                        <Icon name="link" />
                        {language.t("settings.mcp.title")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="externalAgents">
                        <Icon name="terminal" />
                        {language.t("settings.externalAgents.title")}
                      </TabsV2.Trigger>
                    </div>
                  </div>
                </div>
              </div>
              <div class="settings-v2-nav-footer">
                <span>{language.t("app.name.desktop")}</span>
                <span>v{platform.version}</span>
                <a
                  href="https://github.com/alltomatos/opencode"
                  target="_blank"
                  rel="noreferrer"
                  class="settings-v2-nav-footer-credit"
                >
                  {language.t("settings.footer.credit")}
                </a>
              </div>
            </div>
          </TabsV2.List>
          <TabsV2.Content value="general" class="settings-v2-panel">
            <SettingsGeneralV2 sessionID={sessionID()} />
          </TabsV2.Content>
          <TabsV2.Content value="shortcuts" class="settings-v2-panel">
            <SettingsKeybinds v2 />
          </TabsV2.Content>
          <TabsV2.Content value="servers" class="settings-v2-panel">
            <SettingsServersV2 />
          </TabsV2.Content>
          <TabsV2.Content value="providers" class="settings-v2-panel">
            <SettingsProvidersV2 directory={directory} onBack={showProviders} />
          </TabsV2.Content>
          <TabsV2.Content value="models" class="settings-v2-panel">
            <SettingsModelsV2 />
          </TabsV2.Content>
          <TabsV2.Content value="skills" class="settings-v2-panel">
            <SettingsSkillsV2 directory={directory} />
          </TabsV2.Content>
          <TabsV2.Content value="mcp" class="settings-v2-panel">
            <SettingsMcpV2 />
          </TabsV2.Content>
          <TabsV2.Content value="externalAgents" class="settings-v2-panel">
            <SettingsExternalAgentsV2 />
          </TabsV2.Content>
        </TabsV2>
      </div>
    </div>
  )
}
