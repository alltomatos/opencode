import { createEffect, createMemo, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { UpdateAvailableToast } from "@/components/update-available-toast"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { AppProjectSidebar } from "@/pages/layout/app-project-sidebar"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const updateVersion = createMemo(() => {
    const state = platform.updater?.state()
    if (state?.status !== "ready") return
    return state.version
  })
  const installUpdate = () => void platform.updater?.install()
  const update: TitlebarUpdate = {
    version: updateVersion,
    installing: () => platform.updater?.state().status === "installing",
    install: installUpdate,
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <Show when={updateVersion() !== undefined}>
        <UpdateAvailableToast version={updateVersion() ?? ""} install={installUpdate} />
      </Show>
      <div class="flex-1 min-h-0 min-w-0 flex flex-row items-stretch">
        <AppProjectSidebar />
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
