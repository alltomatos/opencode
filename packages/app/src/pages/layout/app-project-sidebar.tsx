import { Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import type { ServerConnection } from "@/context/server"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeScrollController } from "@/pages/home/home-scroll-controller"
import { HomeProjects } from "@/pages/home/home-projects"

// Persistent, collapsible project switcher shown alongside every route (Home
// and an open session alike) — unlike the titlebar's grid-icon toggle, this
// never navigates away from the current session to reach it.
export const AppProjectSidebar: Component = () => {
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()
  const home = createHomeController()
  const projectsController = createHomeProjectsController(home)
  const scroll = createHomeScrollController(() => [])

  const selectProject = (conn: ServerConnection.Any, directory: string) => {
    home.project.select(conn, directory)
    if (layout.route().type !== "home") navigate("/")
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
        <div class="flex h-9 shrink-0 items-center justify-end pr-1">
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
        <HomeProjects projects={projects} scroll={scroll} />
      </div>
    </Show>
  )
}
