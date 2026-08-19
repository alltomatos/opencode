import { onCleanup, onMount, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { dismissToast, showToast } from "@/utils/toast"

export const UpdateAvailableToast: Component<{ version: string; install: () => void }> = (props) => {
  const language = useLanguage()
  let toastId: number | undefined

  onMount(() => {
    toastId = showToast({
      persistent: true,
      icon: "download",
      title: language.t("toast.update.title"),
      description: language.t("toast.update.description", { version: props.version }),
      actions: [
        {
          label: language.t("toast.update.action.installRestart"),
          onClick: props.install,
        },
        {
          label: language.t("toast.update.action.notYet"),
          onClick: "dismiss",
        },
      ],
    })
  })

  onCleanup(() => {
    if (toastId === undefined) return
    dismissToast(toastId)
  })

  return null
}
