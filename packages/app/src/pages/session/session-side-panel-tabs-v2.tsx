import { For, Show, onCleanup, type JSX } from "solid-js"
import { DragDropProvider as DndKitProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

import { SessionContextTab, SortableTabV2 } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useCommand } from "@/context/command"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { SESSION_OPEN_FILE_TAB } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionFileBrowserTab, type SessionFileBrowserState } from "@/pages/session/v2/session-file-browser-tab"
import { reviewTabID, reviewTabPanelID } from "@/pages/session/session-side-panel-tabs-legacy"

const fileBrowserTabPanelID = "session-side-panel-file-browser-tabpanel"

export function SessionSidePanelTabsV2(props: {
  activeTab: () => string
  activateTab: (value: string) => void
  contextOpen: () => boolean
  panelTabs: () => string[]
  temporaryTab: () => string | undefined
  reviewTab: () => boolean
  canReview: () => boolean
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewHasFocusableContent: () => boolean
  reviewSidebarToggle?: (disabled: boolean) => JSX.Element
  projectDirectory: () => string
  fileBrowserState: SessionFileBrowserState
  fileBrowserMounted: () => boolean
  fileBrowserVisible: () => boolean
  browserTab: () => string | undefined
  activeFileTab: () => string | undefined
  kinds: () => Map<string, "add" | "del" | "mix">
  onTabClose: (tab: string) => void
  onTabDoubleClickOpen: (tab: string) => void
  onOpenFileBrowser: () => void
  onPreviewTab: (path: string) => void
  onOpenTab: (path: string) => void
  onFilterRef: (element: HTMLInputElement | undefined) => void
}) {
  const command = useCommand()
  const file = useFile()
  const language = useLanguage()
  const settings = useSettings()
  const { tabs } = useSessionLayout()

  let tabList: HTMLDivElement | undefined

  const openFileKeybind = () => command.keybindParts("file.open")
  const closeTabKeybind = () => command.keybindParts("tab.close")

  return (
    <DndKitProvider
      sensors={[
        PointerSensor.configure({
          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) =>
            event.target instanceof Element &&
            (!!event.target.closest('[data-slot="tabs-trigger-close-button"]') ||
              !!event.target.closest(".session-review-v2-open-in-app-slot")),
        }),
      ]}
      modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => tabList ?? null })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== Accessibility),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
        Feedback.configure({ dropAnimation: null }),
      ]}
      onDragEnd={(event) => {
        const source = event.operation.source
        if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
        tabs().move(source.id.toString(), source.index)
      }}
    >
      <Tabs value={props.activeTab()} onChange={props.activateTab}>
        <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
          <Tabs.List
            ref={(el: HTMLDivElement) => {
              tabList = el
              const stop = createFileTabListSync({ el, contextOpen: props.contextOpen })
              onCleanup(stop)
            }}
          >
            <Show when={props.reviewSidebarToggle}>
              {(toggle) => (
                <div class="session-review-v2-sidebar-toggle-slot h-full shrink-0 sticky left-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                  {toggle()(props.activeTab() === SESSION_OPEN_FILE_TAB)}
                </div>
              )}
            </Show>
            <Show when={props.reviewTab() && props.canReview()}>
              <Tabs.Trigger
                value="review"
                id={reviewTabID}
                aria-controls={props.activeTab() === "review" ? reviewTabPanelID : undefined}
              >
                {props.hasReview()
                  ? language.t("session.review.filesChanged", { count: props.reviewCount() })
                  : language.t("session.tab.review")}
              </Tabs.Trigger>
            </Show>
            <Show when={props.contextOpen()}>
              <Tabs.Trigger
                value="context"
                closeButton={
                  <TooltipV2
                    value={
                      <>
                        {language.t("common.closeTab")}
                        <Show when={closeTabKeybind().length > 0}>
                          <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                        </Show>
                      </>
                    }
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
                  </TooltipV2>
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
            <For each={props.panelTabs()}>
              {(tab) => (
                <Show
                  when={tab === SESSION_OPEN_FILE_TAB}
                  fallback={
                    <SortableTabV2
                      tab={tab}
                      index={() => tabs().all().indexOf(tab)}
                      temporary={props.temporaryTab() === tab}
                      onTabClose={props.onTabClose}
                      onTabDoubleClick={props.temporaryTab() === tab ? props.onTabDoubleClickOpen : undefined}
                    />
                  }
                >
                  <Tabs.Trigger
                    value={SESSION_OPEN_FILE_TAB}
                    closeButton={
                      <TooltipV2
                        value={
                          <>
                            {language.t("common.closeTab")}
                            <Show when={closeTabKeybind().length > 0}>
                              <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                            </Show>
                          </>
                        }
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
                      </TooltipV2>
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
            <div
              class="h-full shrink-0 sticky right-0 z-10 flex items-center justify-center"
              classList={{
                "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                "bg-background-stronger": !settings.general.newLayoutDesigns(),
              }}
            >
              <TooltipV2
                value={
                  <>
                    {language.t("command.file.open")}
                    <Show when={openFileKeybind().length > 0}>
                      <KeybindV2 keys={openFileKeybind()} variant="neutral" />
                    </Show>
                  </>
                }
                placement="bottom"
                class="flex items-center"
              >
                <IconButtonV2
                  icon={<Icon name="plus-small" />}
                  variant="ghost-muted"
                  size="large"
                  onClick={() => props.onOpenFileBrowser()}
                  aria-label={language.t("command.file.open")}
                />
              </TooltipV2>
            </div>
          </Tabs.List>
          <div
            class="session-review-v2-open-in-app-slot shrink-0 flex items-center pr-3"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <OpenInAppV2 directory={props.projectDirectory} />
          </div>
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

        <Show when={props.fileBrowserMounted()}>
          <div
            id={fileBrowserTabPanelID}
            role="tabpanel"
            data-slot="tabs-content"
            class="h-full min-h-0 overflow-hidden"
            classList={{ hidden: !props.fileBrowserVisible() }}
            inert={!props.fileBrowserVisible() || undefined}
          >
            <SessionFileBrowserTab
              tab={props.browserTab() ?? props.activeFileTab() ?? SESSION_OPEN_FILE_TAB}
              placeholder={(props.browserTab() ?? props.activeFileTab() ?? SESSION_OPEN_FILE_TAB) === SESSION_OPEN_FILE_TAB}
              active={file.pathFromTab(props.browserTab() ?? props.activeFileTab() ?? "")}
              kinds={props.kinds()}
              state={props.fileBrowserState}
              onSelect={(path) => props.onPreviewTab(file.tab(path))}
              onSelectPermanent={(path) => props.onOpenTab(file.tab(path))}
              filterRef={(element) => props.onFilterRef(element)}
            />
          </div>
        </Show>
      </Tabs>
    </DndKitProvider>
  )
}
