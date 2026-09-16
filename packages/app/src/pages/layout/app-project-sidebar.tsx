import { Show, createEffect, type Component, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLayout, type ProjectSidebarTab } from "@/context/layout"
import { useLanguage } from "@/context/language"
import type { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeScrollController } from "@/pages/home/home-scroll-controller"
import { HomeProjects } from "@/pages/home/home-projects"
import { HomeUtilityNav } from "@/pages/home/home-projects-view"
import { BatutaSidebarList } from "@/pages/batuta/batuta-sidebar-list"
import { AgentUISidebarList } from "@/pages/agentui/agentui-sidebar-list"
import { RoutinesSidebarList } from "@/pages/routines/routines-sidebar-list"

// Batuta is still an active work-in-progress feature — only show its entry
// point on dev builds, not to production users, until it's ready to ship.
const BATUTA_VISIBLE = import.meta.env.VITE_OPENCODE_CHANNEL === "dev"

// Persistent, collapsible project switcher shown alongside every route (Home
// and an open session alike) — unlike the titlebar's grid-icon toggle, this
// never navigates away from the current session to reach it.
export const AppProjectSidebar: Component = () => {
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const home = createHomeController()
  const projectsController = createHomeProjectsController(home)
  const scroll = createHomeScrollController(() => [])

  // Safety net for anyone who had "batuta" persisted from a dev build before
  // switching to a non-dev build (or from before this gate existed) — don't
  // strand them on a hidden tab with no way back via the UI.
  createEffect(() => {
    if (BATUTA_VISIBLE) return
    if (layout.projectSidebar.tab() !== "batuta") return
    layout.projectSidebar.setTab("code")
    if (location.pathname === "/batuta") navigate("/")
  })

  const selectProject = (conn: ServerConnection.Any, directory: string) => {
    home.project.select(conn, directory)
    if (location.pathname !== "/") navigate("/")
  }

  const selectTab = (tab: ProjectSidebarTab) => {
    layout.projectSidebar.setTab(tab)
    if (tab === "batuta" && location.pathname !== "/batuta") navigate("/batuta")
    if (tab === "agentui" && location.pathname !== "/agentui") navigate("/agentui")
    if (tab === "schedule" && location.pathname !== "/rotinas") navigate("/rotinas")
    if (
      tab === "code" &&
      (location.pathname === "/batuta" || location.pathname === "/agentui" || location.pathname === "/rotinas")
    )
      navigate("/")
  }

  const routinesLabel = () => (language.locale() === "br" ? "Rotinas" : "Routines")

  const projects = {
    ...projectsController,
    project: { ...projectsController.project, select: selectProject },
  }

  return (
    <Show
      when={layout.projectSidebar.opened()}
      fallback={
        <div class="flex h-full w-12 shrink-0 flex-col items-center justify-between border-r border-v2-border-border-base py-2">
          <div class="flex w-full flex-col items-center gap-1.5 px-1">
            <TooltipV2 placement="right" value={language.t("home.projects")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<Icon name="sidebar" />}
                aria-label={language.t("home.projects")}
                onClick={() => layout.projectSidebar.open()}
              />
            </TooltipV2>
            <div class="my-0.5 h-px w-6 bg-v2-border-border-base" />
            <ProjectRailTabButton
              active={layout.projectSidebar.tab() === "code"}
              label={language.t("sidebar.tab.code")}
              onClick={() => {
                if (layout.projectSidebar.tab() === "code") {
                  layout.projectSidebar.open()
                } else {
                  selectTab("code")
                }
              }}
            >
              <Icon name="code" size="small" />
            </ProjectRailTabButton>
            <Show when={BATUTA_VISIBLE}>
              <ProjectRailTabButton
                active={layout.projectSidebar.tab() === "batuta"}
                label={language.t("sidebar.tab.batuta")}
                onClick={() => {
                  if (layout.projectSidebar.tab() === "batuta") {
                    layout.projectSidebar.open()
                  } else {
                    selectTab("batuta")
                  }
                }}
              >
                <IconV2 name="batuta" size="small" />
              </ProjectRailTabButton>
            </Show>
            <ProjectRailTabButton
              active={layout.projectSidebar.tab() === "agentui"}
              label={language.t("sidebar.tab.agentui")}
              onClick={() => {
                if (layout.projectSidebar.tab() === "agentui") {
                  layout.projectSidebar.open()
                } else {
                  selectTab("agentui")
                }
              }}
            >
              <IconV2 name="subagent" size="small" />
            </ProjectRailTabButton>
            <ProjectRailTabButton
              active={layout.projectSidebar.tab() === "schedule"}
              label={routinesLabel()}
              onClick={() => {
                if (layout.projectSidebar.tab() === "schedule") {
                  layout.projectSidebar.open()
                } else {
                  selectTab("schedule")
                }
              }}
            >
              <Icon name="task" size="small" />
            </ProjectRailTabButton>
          </div>
          <div class="flex w-full flex-col items-center gap-1.5 px-1">
            <TooltipV2 placement="right" value={language.t("sidebar.stats")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="chart" size="small" />}
                aria-label={language.t("sidebar.stats")}
                onClick={() => navigate("/stats")}
              />
            </TooltipV2>
            <TooltipV2 placement="right" value={language.t("sidebar.settings")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="settings-gear" size="small" />}
                aria-label={language.t("sidebar.settings")}
                onClick={projectsController.utility.settings}
              />
            </TooltipV2>
            <TooltipV2 placement="right" value={language.t("sidebar.help")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="help" size="small" />}
                aria-label={language.t("sidebar.help")}
                onClick={projectsController.utility.help}
              />
            </TooltipV2>
          </div>
        </div>
      }
    >
      <div
        class="relative flex min-h-0 shrink-0 flex-col border-r border-v2-border-border-base px-2 pb-2"
        style={{ width: `${layout.projectSidebar.width()}px` }}
      >
        <div class="flex h-12 shrink-0 items-center justify-between gap-1.5">
          <ProjectSidebarTabs
            tab={layout.projectSidebar.tab()}
            onSelect={selectTab}
            language={language}
            routinesLabel={routinesLabel()}
          />
          <TooltipV2 placement="bottom" value={language.t("home.projects")}>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name={layout.projectSidebar.opened() ? "sidebar-active" : "sidebar"} />}
              aria-label={language.t("home.projects")}
              onClick={() => layout.projectSidebar.close()}
            />
          </TooltipV2>
        </div>
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={layout.projectSidebar.tab() === "code"} fallback={
            <ServerSDKProvider server={home.server.focused}>
              <Show when={layout.projectSidebar.tab() === "batuta"} fallback={
                <Show when={layout.projectSidebar.tab() === "schedule"} fallback={<AgentUISidebarList />}>
                  <RoutinesSidebarList />
                </Show>
              }>
                <BatutaSidebarList />
              </Show>
            </ServerSDKProvider>
          }>
            <HomeProjects projects={projects} scroll={scroll} />
          </Show>
        </div>
        <HomeUtilityNav
          class="mt-2 flex shrink-0 border-t border-v2-border-border-base pt-2"
          onOpenSettings={projectsController.utility.settings}
          onOpenHelp={projectsController.utility.help}
          onOpenStats={() => navigate("/stats")}
          language={language}
        />
      </div>
    </Show>
  )
}

const ProjectSidebarTabs: Component<{
  tab: ProjectSidebarTab
  onSelect: (tab: ProjectSidebarTab) => void
  language: ReturnType<typeof useLanguage>
  routinesLabel: string
}> = (props) => {
  return (
    <div class="flex h-10 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-[8px] bg-v2-background-bg-layer-01 p-0.5">
      <ProjectSidebarTabButton
        active={props.tab === "code"}
        label={props.language.t("sidebar.tab.code")}
        onClick={() => props.onSelect("code")}
      >
        <Icon name="code" size="small" />
      </ProjectSidebarTabButton>
      <Show when={BATUTA_VISIBLE}>
        <ProjectSidebarTabButton
          active={props.tab === "batuta"}
          label={props.language.t("sidebar.tab.batuta")}
          onClick={() => props.onSelect("batuta")}
        >
          <IconV2 name="batuta" size="small" />
        </ProjectSidebarTabButton>
      </Show>
      <ProjectSidebarTabButton
        active={props.tab === "agentui"}
        label={props.language.t("sidebar.tab.agentui")}
        onClick={() => props.onSelect("agentui")}
      >
        <IconV2 name="subagent" size="small" />
      </ProjectSidebarTabButton>
      <ProjectSidebarTabButton
        active={props.tab === "schedule"}
        label={props.routinesLabel}
        onClick={() => props.onSelect("schedule")}
      >
        <Icon name="task" size="small" />
      </ProjectSidebarTabButton>
    </div>
  )
}

const ProjectSidebarTabButton: Component<{
  active: boolean
  label: string
  onClick: () => void
  children: JSX.Element
}> = (props) => {
  return (
    <TooltipV2 placement="bottom" value={props.label} class="flex h-full min-w-0 flex-1">
      <button
        type="button"
        class={`
          flex h-full w-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[6px] px-1 text-v2-text-text-muted
          transition-colors duration-[120ms] ease-in-out
          hover:text-v2-text-text-base
        `}
        classList={{
          "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.active,
        }}
        aria-label={props.label}
        aria-pressed={props.active}
        onClick={props.onClick}
      >
        <div class="flex size-4 shrink-0 items-center justify-center">
          {props.children}
        </div>
        <span class="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-[10px] font-medium leading-none">
          {props.label}
        </span>
      </button>
    </TooltipV2>
  )
}

const ProjectRailTabButton: Component<{
  active: boolean
  label: string
  onClick: () => void
  children: JSX.Element
}> = (props) => {
  return (
    <TooltipV2 placement="right" value={props.label} class="flex w-full">
      <button
        type="button"
        class={`
          flex w-full flex-col items-center justify-center gap-1 rounded-[6px] px-0.5 py-1.5 text-v2-text-text-muted
          transition-colors duration-[120ms] ease-in-out
          hover:text-v2-text-text-base
        `}
        classList={{
          "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.active,
        }}
        aria-label={props.label}
        aria-pressed={props.active}
        onClick={props.onClick}
      >
        <div class="flex size-4 shrink-0 items-center justify-center">
          {props.children}
        </div>
        <span class="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-[9px] font-medium leading-none">
          {props.label}
        </span>
      </button>
    </TooltipV2>
  )
}

