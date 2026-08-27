import { useNavigate, useParams } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function useSettingsDialog(defaultValue?: string) {
  const dialog = useDialog()
  const settings = useSettings()
  const navigate = useNavigate()
  const params = useParams<{ id?: string }>()
  let run = 0
  let dead = false

  onCleanup(() => {
    dead = true
  })

  return () => {
    if (settings.general.newLayoutDesigns()) {
      // The settings route has no :id segment of its own, so the session
      // that was active when settings were opened (needed to scope the
      // per-session permission toggle) has to travel as a query param —
      // otherwise it's lost the moment navigate() changes the URL.
      const search = params.id ? `?session=${encodeURIComponent(params.id)}` : ""
      navigate(`/settings/${defaultValue ?? "general"}${search}`)
      return
    }
    const current = ++run
    const sessionID = params.id
    void import("@/components/settings-v2").then((module) => {
      if (dead || run !== current) return
      void dialog.show(() => <module.DialogSettings sessionID={sessionID} defaultValue={defaultValue} />)
    })
  }
}

export function useSettingsCommand() {
  const command = useCommand()
  const language = useLanguage()
  const show = useSettingsDialog()

  command.register("settings", () => [
    {
      id: "settings.open",
      title: language.t("command.settings.open"),
      category: language.t("command.category.settings"),
      keybind: "mod+comma",
      onSelect: show,
    },
  ])

  return show
}
