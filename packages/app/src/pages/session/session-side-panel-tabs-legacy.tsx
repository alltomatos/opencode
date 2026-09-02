import { For, Show, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Mark } from "@opencode-ai/ui/logo"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useCommand } from "@/context/command"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { SESSION_OPEN_FILE_TAB, getTabReorderIndex } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"

export const reviewTabID = "session-side-panel-review-tab"
export const reviewTabPanelID = "session-side-panel-review-tabpanel"

export function SessionSidePanelTabsLegacy(props: {
  activeTab: () => string
  activateTab: (value: string) => void
  contextOpen: () => boolean
  panelTabs: () => string[]
  openedTabs: () => string[]
  temporaryTab: () => string | undefined
  reviewTab: () => boolean
  canReview: () => boolean
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewHasFocusableContent: () => boolean
  activeFileTab: () => string | undefined
  onTabClose: (tab: string) => void
  onTabDoubleClickOpen: (tab: string) => void
  onOpenFileClick: () => void
}) {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const settings = useSettings()
  const { tabs } = useSessionLayout()
  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      collisionDetector={closestCenter}
    >
      <DragDropSensors />
      <ConstrainDragYAxis />
      <Tabs value={props.activeTab()} onChange={props.activateTab}>
        <div class="sticky top-0 shrink-0 flex">
          <Tabs.List
            ref={(el: HTMLDivElement) => {
              const stop = createFileTabListSync({ el, contextOpen: props.contextOpen })
              onCleanup(stop)
            }}
          >
            <Show when={props.reviewTab() && props.canReview()}>
              <Tabs.Trigger
                value="review"
                id={reviewTabID}
                aria-controls={props.activeTab() === "review" ? reviewTabPanelID : undefined}
              >
                <div class="flex items-center gap-1.5">
                  <div>{language.t("session.tab.review")}</div>
                  <Show when={props.hasReview()}>
                    <div>{props.reviewCount()}</div>
                  </Show>
                </div>
              </Tabs.Trigger>
            </Show>
            <Show when={props.contextOpen()}>
              <Tabs.Trigger
                value="context"
                closeButton={
                  <TooltipKeybind
                    title={language.t("common.closeTab")}
                    keybind={command.keybind("tab.close")}
                    placement="bottom"
                    gutter={10}
                  >
                    <IconButton
                      icon="close-small"
                      variant="ghost"
                      class="h-5 w-5"
                      onClick={() => props.onTabClose("context")}
                      aria-label={language.t("common.closeTab")}
                    />
                  </TooltipKeybind>
                }
                hideCloseButton
                onMiddleClick={() => props.onTabClose("context")}
              >
                <div class="flex items-center gap-2">
                  <SessionContextUsage variant="indicator" />
                  <div>{language.t("session.tab.context")}</div>
                </div>
              </Tabs.Trigger>
            </Show>
            <SortableProvider ids={props.openedTabs()}>
              <For each={props.panelTabs()}>
                {(tab) => (
                  <Show
                    when={tab === SESSION_OPEN_FILE_TAB}
                    fallback={
                      <SortableTab
                        tab={tab}
                        temporary={props.temporaryTab() === tab}
                        onTabClose={props.onTabClose}
                        onTabDoubleClick={props.temporaryTab() === tab ? props.onTabDoubleClickOpen : undefined}
                      />
                    }
                  >
                    <Tabs.Trigger
                      value={SESSION_OPEN_FILE_TAB}
                      closeButton={
                        <TooltipKeybind
                          title={language.t("common.closeTab")}
                          keybind={command.keybind("tab.close")}
                          placement="bottom"
                          gutter={10}
                        >
                          <IconButton
                            icon="close-small"
                            variant="ghost"
                            class="h-5 w-5"
                            onClick={() => props.onTabClose(SESSION_OPEN_FILE_TAB)}
                            aria-label={language.t("common.closeTab")}
                          />
                        </TooltipKeybind>
                      }
                      hideCloseButton
                      onMiddleClick={() => props.onTabClose(SESSION_OPEN_FILE_TAB)}
                    >
                      <div class="flex items-center gap-1.5 italic">
                        <Icon name="open-file" size="small" />
                        <span>{language.t("command.file.open")}</span>
                      </div>
                    </Tabs.Trigger>
                  </Show>
                )}
              </For>
            </SortableProvider>
            <div
              class="h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3"
              classList={{
                "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                "bg-background-stronger": !settings.general.newLayoutDesigns(),
              }}
            >
              <TooltipKeybind
                title={language.t("command.file.open")}
                keybind={command.keybind("file.open")}
                class="flex items-center"
              >
                <IconButton
                  icon="plus-small"
                  variant="ghost"
                  iconSize="large"
                  class="!rounded-md"
                  onClick={() => {
                    void import("@/components/dialog-select-file").then((x) => {
                      dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={props.onOpenFileClick} />)
                    })
                  }}
                  aria-label={language.t("command.file.open")}
                />
              </TooltipKeybind>
            </div>
          </Tabs.List>
        </div>

        <Show when={props.reviewTab() && props.canReview() && props.activeTab() === "review"}>
          <div
            id={reviewTabPanelID}
            role="tabpanel"
            aria-labelledby={reviewTabID}
            tabIndex={props.reviewHasFocusableContent() ? undefined : 0}
            data-slot="tabs-content"
            class="flex flex-col h-full overflow-hidden contain-strict"
          >
            {props.reviewPanel()}
          </div>
        </Show>

        <Show when={props.activeTab() === "empty"}>
          <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                <Mark class="w-14 opacity-10" />
                <div class="text-14-regular text-text-weak max-w-56">{language.t("session.files.selectToOpen")}</div>
              </div>
            </div>
          </Tabs.Content>
        </Show>

        <Show when={props.activeTab() === "context"}>
          <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <SessionContextTab />
            </div>
          </Tabs.Content>
        </Show>

        <Show when={props.activeFileTab()} keyed>
          {(tab) => <FileTabContent tab={tab} />}
        </Show>
      </Tabs>
      <DragOverlay>
        <Show when={store.activeDraggable} keyed>
          {(tab) => {
            const path = file.pathFromTab(tab)
            return (
              <div data-component="tabs-drag-preview">
                <Show when={path}>{(p) => <FileVisual active path={p()} temporary={props.temporaryTab() === tab} />}</Show>
              </div>
            )
          }}
        </Show>
      </DragOverlay>
    </DragDropProvider>
  )
}
