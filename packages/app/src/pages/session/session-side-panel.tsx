import { Show, createEffect, createMemo, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"

import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"

import { normalizeFileTreeV2Path } from "@/components/file-tree-v2-model"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import {
  SESSION_OPEN_FILE_TAB,
  createOpenSessionFileTab,
  createSessionTabs,
  shouldShowFileTree,
  type Sizing,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionSidePanelFileTree } from "@/pages/session/session-side-panel-file-tree"
import { SessionSidePanelTabsLegacy } from "@/pages/session/session-side-panel-tabs-legacy"
import { SessionSidePanelTabsV2 } from "@/pages/session/session-side-panel-tabs-v2"
import type { SessionFileBrowserState } from "@/pages/session/v2/session-file-browser-tab"

type ReviewDiff = FileDiffInfo | SnapshotFileDiff | VcsFileDiff
type RenderDiff = FileDiffInfo | (SnapshotFileDiff & { file: string }) | VcsFileDiff
const FILE_TREE_WIDTH_MIN = 240

function renderDiff(value: ReviewDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewHasFocusableContent: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewSidebarToggle?: (disabled: boolean) => JSX.Element
  fileBrowserState?: SessionFileBrowserState
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  stacked?: boolean
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()
  const sdk = useSDK()
  const { sessionKey, tabs, view, params } = useSessionLayout()
  const projectDirectory = createMemo(() => sdk().directory)

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const shown = settings.visibility.fileTree

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: shown(),
        opened: layout.fileTree.opened(),
      }),
  )
  const open = createMemo(() => reviewOpen() || fileOpen())
  const fileTreeWidth = createMemo(() => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width()))
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${fileTreeWidth()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalizeFileTreeV2Path(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
    fileBrowser: () => !!props.fileBrowserState,
  })
  const contextOpen = tabState.contextOpen
  const openFileOpen = tabState.openFileOpen
  const panelTabs = tabState.panelTabs
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  let fileFilter: HTMLInputElement | undefined
  const temporaryTab = tabs().preview
  const previewTab = (value: string) => {
    const next = normalizeTab(value)
    tabs().previewTab(next)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    queueMicrotask(() => tabs().setActive(next))
  }
  const openFileBrowser = () => {
    previewTab(SESSION_OPEN_FILE_TAB)
    queueMicrotask(() => fileFilter?.focus())
  }
  const activateTab = (value: string) => {
    const next = normalizeTab(value)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    tabs().setActive(next)
  }
  const browserTab = createMemo(() => {
    if (!props.fileBrowserState) return undefined
    const active = activeTab()
    if (active === SESSION_OPEN_FILE_TAB) return SESSION_OPEN_FILE_TAB
    if (active && file.pathFromTab(active)) return active
    return activeFileTab()
  })
  // Keep the file-browser shell mounted while any file tab exists. Kobalte briefly
  // selects Review while the tab For replaces a preview trigger, which would
  // otherwise dispose the sidebar and reset scroll.
  const fileBrowserMounted = createMemo(() => {
    if (!props.fileBrowserState) return false
    return openedTabs().length > 0 || openFileOpen() || !!browserTab()
  })
  const fileBrowserVisible = createMemo(() => {
    const active = activeTab()
    return active !== "review" && active !== "context" && active !== "empty"
  })

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  return (
    <Show when={isDesktop() && !(settings.general.newLayoutDesigns() && !params.id)}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex overflow-hidden"
        classList={{
          "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
          "bg-background-base": !settings.general.newLayoutDesigns(),
          "h-full shrink-0": !props.stacked,
          "h-full min-h-0": props.stacked,
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
          "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": settings.general.newLayoutDesigns(),
          "flex-1": reviewOpen(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={open()}>
          <div
            class="size-full flex"
            classList={{
              "border-l border-border-weaker-base": !settings.general.newLayoutDesigns(),
            }}
          >
            <Show when={reviewOpen()}>
              <div
                class="relative min-w-0 h-full flex-1 overflow-hidden"
                classList={{
                  "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                  "bg-background-base": !settings.general.newLayoutDesigns(),
                }}
              >
                <div
                  class="size-full min-w-0 h-full"
                  classList={{
                    "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                    "bg-background-base": !settings.general.newLayoutDesigns(),
                  }}
                >
                  <Show
                    when={props.fileBrowserState}
                    fallback={
                      <SessionSidePanelTabsLegacy
                        activeTab={activeTab}
                        activateTab={activateTab}
                        contextOpen={contextOpen}
                        panelTabs={panelTabs}
                        openedTabs={openedTabs}
                        temporaryTab={temporaryTab}
                        reviewTab={reviewTab}
                        canReview={props.canReview}
                        hasReview={props.hasReview}
                        reviewCount={props.reviewCount}
                        reviewPanel={props.reviewPanel}
                        reviewHasFocusableContent={props.reviewHasFocusableContent}
                        activeFileTab={activeFileTab}
                        onTabClose={tabs().close}
                        onTabDoubleClickOpen={openTab}
                        onOpenFileClick={showAllFiles}
                      />
                    }
                  >
                    {(fileBrowserState) => (
                      <SessionSidePanelTabsV2
                        activeTab={activeTab}
                        activateTab={activateTab}
                        contextOpen={contextOpen}
                        panelTabs={panelTabs}
                        temporaryTab={temporaryTab}
                        reviewTab={reviewTab}
                        canReview={props.canReview}
                        hasReview={props.hasReview}
                        reviewCount={props.reviewCount}
                        reviewPanel={props.reviewPanel}
                        reviewHasFocusableContent={props.reviewHasFocusableContent}
                        reviewSidebarToggle={props.reviewSidebarToggle}
                        projectDirectory={projectDirectory}
                        fileBrowserState={fileBrowserState()}
                        fileBrowserMounted={fileBrowserMounted}
                        fileBrowserVisible={fileBrowserVisible}
                        browserTab={browserTab}
                        activeFileTab={activeFileTab}
                        kinds={kinds}
                        onTabClose={tabs().close}
                        onTabDoubleClickOpen={openTab}
                        onOpenFileBrowser={openFileBrowser}
                        onPreviewTab={(path) => previewTab(file.tab(path))}
                        onOpenTab={(path) => openTab(file.tab(path))}
                        onFilterRef={(element) => (fileFilter = element)}
                      />
                    )}
                  </Show>
                </div>
              </div>
            </Show>

            <SessionSidePanelFileTree
              reviewOpen={reviewOpen}
              fileOpen={fileOpen}
              treeWidth={treeWidth}
              size={props.size}
              reviewCount={props.reviewCount}
              hasReview={props.hasReview}
              diffsReady={props.diffsReady}
              diffFiles={diffFiles}
              kinds={kinds}
              activeDiff={props.activeDiff}
              focusReviewDiff={props.focusReviewDiff}
              onOpenTab={openTab}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
