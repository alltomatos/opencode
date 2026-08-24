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
    if (tab === "code" && location.pathname === "/batuta") navigate("/")
  }

  const projects = {
    ...projectsController,
    project: { ...projectsController.project, select: selectProject },
  }

  return (
    <Show
      when={layout.projectSidebar.opened()}
      fallback={
        <div class="flex w-9 shrink-0 flex-col items-center border-r border-v2-border-border-base pt-2">
          <TooltipV2 placement="right" value={language.t("home.projects")}>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name={layout.projectSidebar.opened() ? "sidebar-active" : "sidebar"} />}
              aria-label={language.t("home.projects")}
              onClick={() => layout.projectSidebar.open()}
            />
          </TooltipV2>
        </div>
      }
    >
      <div
        class="relative flex min-h-0 shrink-0 flex-col border-r border-v2-border-border-base px-2 pb-2"
        style={{ width: `${layout.projectSidebar.width()}px` }}
      >
        <div class="flex h-9 shrink-0 items-center justify-between gap-1 pr-1">
          <ProjectSidebarTabs tab={layout.projectSidebar.tab()} onSelect={selectTab} language={language} />
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
          <Show
            when={layout.projectSidebar.tab() === "batuta"}
            fallback={<HomeProjects projects={projects} scroll={scroll} />}
          >
            <ServerSDKProvider server={home.server.focused}>
              <BatutaSidebarList />
            </ServerSDKProvider>
          </Show>
        </div>
        <HomeUtilityNav
          class="mt-2 flex shrink-0 border-t border-v2-border-border-base pt-2"
          onOpenSettings={projectsController.utility.settings}
          onOpenHelp={projectsController.utility.help}
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
}> = (props) => {
  return (
    <Show
      when={BATUTA_VISIBLE}
      fallback={
        <div class="flex h-7 min-w-0 flex-1 items-center px-1 text-12-medium text-v2-text-text-muted">
          {props.language.t("sidebar.tab.code")}
        </div>
      }
    >
      <div class="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-[8px] bg-v2-background-bg-layer-01 p-0.5">
        <ProjectSidebarTabButton
          active={props.tab === "code"}
          label={props.language.t("sidebar.tab.code")}
          onClick={() => props.onSelect("code")}
        >
          <Icon name="code" size="small" />
        </ProjectSidebarTabButton>
        <ProjectSidebarTabButton
          active={props.tab === "batuta"}
          label={props.language.t("sidebar.tab.batuta")}
          onClick={() => props.onSelect("batuta")}
        >
          <IconV2 name="batuta" size="small" />
        </ProjectSidebarTabButton>
      </div>
    </Show>
  )
}

const ProjectSidebarTabButton: Component<{
  active: boolean
  label: string
  onClick: () => void
  children: JSX.Element
}> = (props) => {
  return (
    <button
      type="button"
      class={`
        flex h-6 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 text-12-medium text-v2-text-text-muted
        transition-colors duration-[120ms] ease-in-out
        hover:text-v2-text-text-base
      `}
      classList={{
        "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.active,
      }}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  )
}
