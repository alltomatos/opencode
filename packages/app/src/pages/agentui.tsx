import { createMemo, type Component } from "solid-js"
import { SettingsAgentUIV2 } from "@/components/settings-v2/agentui"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { createHomeController } from "@/pages/home/home-controller"
import "@/components/settings-v2/settings-v2.css"

export const AgentUIPage: Component = () => {
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const home = createHomeController()

  // Same resolution pages/settings.tsx uses: pick whatever project/session
  // is currently in view, so the sandbox test chat (see agentui.tsx) runs
  // against that project's connected models/skills by default.
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

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="settings-v2-panel">
        <SettingsAgentUIV2 directory={directory()} />
      </div>
    </div>
  )
}
