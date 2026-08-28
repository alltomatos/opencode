import { createMemo, createSignal } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { isBrowserPanelAvailable, isBrowserPanelOpen } from "@/components/browser-panel"
import { createSizing, shouldShowFileTree } from "@/pages/session/helpers"
import { sessionPanelLayout } from "@/pages/session/session-panel-layout"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "@/pages/session/session-panel-width"
import type { useSessionLayout } from "@/pages/session/session-layout"
import type { useSettings } from "@/context/settings"
import type { useLayout } from "@/context/layout"

/**
 * Owns the desktop panel geometry: which panels are open (review, terminal,
 * file tree, browser), the resizable session-panel width and its clamping
 * against the available row width, and the derived "centered"/"split"
 * flags the rest of the page reads. Pure derived layout state plus one
 * ResizeObserver — no session data, no VCS, no scroll.
 */
export function createPanelGeometry(deps: {
  view: ReturnType<typeof useSessionLayout>["view"]
  newSessionDesign: () => boolean
  settings: ReturnType<typeof useSettings>
  layout: ReturnType<typeof useLayout>
  sessionID: () => string | undefined
}) {
  const { view, newSessionDesign, settings, layout, sessionID } = deps

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const desktopV2ReviewOpen = createMemo(() => newSessionDesign() && desktopReviewOpen() && !!sessionID())
  const terminalOpen = createMemo(() => view().terminal.opened())
  const desktopTerminalOpen = createMemo(() => isDesktop() && terminalOpen())
  const desktopInlineTerminalOnlyOpen = createMemo(
    () => newSessionDesign() && desktopTerminalOpen() && !desktopV2ReviewOpen(),
  )
  const desktopFileTreeOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )
  const desktopSessionResizeOpen = createMemo(() =>
    newSessionDesign() ? desktopV2ReviewOpen() || desktopTerminalOpen() : desktopReviewOpen(),
  )
  const desktopSidePanelOpen = createMemo(() => desktopSessionResizeOpen() || desktopFileTreeOpen())

  let panelRow: HTMLDivElement | undefined
  const bindPanelRow = (el: HTMLDivElement) => {
    panelRow = el
  }
  const [panelRowWidth, setPanelRowWidth] = createSignal<number>()
  createResizeObserver(
    () => panelRow,
    ({ width }) => setPanelRowWidth(width),
  )

  const splitReview = createMemo(
    () => (newSessionDesign() ? desktopV2ReviewOpen() : desktopReviewOpen()) && layout.review.diffStyle() === "split",
  )
  // The observer reports the content-box width, which already excludes the row
  // padding; only the flex gap between the panels remains to subtract.
  const sessionPanelAvailable = createMemo(() => {
    const width = panelRowWidth()
    if (width === undefined) return undefined
    return width - (settings.general.newLayoutDesigns() ? 8 : 0)
  })
  const sessionPanelMax = createMemo(() => {
    const available = sessionPanelAvailable()
    if (available === undefined) return 1000
    return sessionPanelWidthMax({ available, split: splitReview() })
  })
  // Clamp at render time so window or sidebar resizes squeeze the chat panel
  // instead of the review pane, without overwriting the persisted width.
  const sessionPanelResizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: layout.session.width(),
      available: sessionPanelAvailable(),
      split: splitReview(),
    }),
  )
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopSessionResizeOpen()) return `${sessionPanelResizedWidth()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && (newSessionDesign() || !desktopReviewOpen()))
  const desktopV2PanelLayout = createMemo(() =>
    sessionPanelLayout({
      review: desktopV2ReviewOpen(),
      terminal: desktopTerminalOpen(),
      files: desktopFileTreeOpen(),
    }),
  )
  const browserPanelOpen = createMemo(() => isBrowserPanelAvailable() && isBrowserPanelOpen())
  const terminalRegionOpen = createMemo(
    () => newSessionDesign() && (isDesktop() ? desktopV2PanelLayout().visible : terminalOpen()),
  )
  const browserPanelStacked = createMemo(() => browserPanelOpen() && terminalRegionOpen())

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  return {
    isDesktop,
    size,
    desktopReviewOpen,
    desktopV2ReviewOpen,
    terminalOpen,
    desktopTerminalOpen,
    desktopInlineTerminalOnlyOpen,
    desktopFileTreeOpen,
    desktopSessionResizeOpen,
    desktopSidePanelOpen,
    bindPanelRow,
    splitReview,
    sessionPanelAvailable,
    sessionPanelMax,
    sessionPanelResizedWidth,
    sessionPanelWidth,
    centered,
    desktopV2PanelLayout,
    browserPanelOpen,
    terminalRegionOpen,
    browserPanelStacked,
    openReviewPanel,
  }
}
