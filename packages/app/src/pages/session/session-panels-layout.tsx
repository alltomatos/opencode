import { ErrorBoundary, Show, Suspense, type Accessor, type JSX } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { BrowserPanelOverlay } from "@/components/browser-panel"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { SessionReviewV2SidebarToggle } from "@opencode-ai/session-ui/v2/session-review-v2"
import { SESSION_PANEL_WIDTH_MIN } from "@/pages/session/session-panel-width"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { TerminalPanelV2 } from "@/pages/session/terminal-panel-v2"
import { SessionRouteFrame, SessionPanelFrame } from "@/pages/session-components"
import { SessionHeader } from "@/components/session"
import type { createPanelGeometry } from "./session-panel-geometry"
import type { createVcsReview } from "./session-vcs-review"
import type { createReviewDiffScroll } from "./session-review-diff-scroll"
import type { createReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import type { useLayout } from "@/context/layout"
import type { useSettings } from "@/context/settings"
import type { useSessionLayout } from "@/pages/session/session-layout"

type PanelGeometry = ReturnType<typeof createPanelGeometry>
type VcsReview = ReturnType<typeof createVcsReview>
type ReviewDiffScroll = ReturnType<typeof createReviewDiffScroll>

export function SessionPanelsLayout(props: {
  bindPanelRow: (el: HTMLDivElement) => void
  settings: ReturnType<typeof useSettings>
  isDesktop: PanelGeometry["isDesktop"]
  hasSessionID: boolean
  mobileTabs: () => JSX.Element
  size: PanelGeometry["size"]
  reviewSnap: boolean
  desktopInlineTerminalOnlyOpen: PanelGeometry["desktopInlineTerminalOnlyOpen"]
  sessionPanelWidth: PanelGeometry["sessionPanelWidth"]
  sessionPanelKey: Accessor<string | undefined>
  sessionErrorFallback: (error: unknown, reset: () => void) => JSX.Element
  sessionPanelContent: () => JSX.Element
  desktopSessionResizeOpen: PanelGeometry["desktopSessionResizeOpen"]
  sessionPanelResizedWidth: PanelGeometry["sessionPanelResizedWidth"]
  sessionPanelMax: PanelGeometry["sessionPanelMax"]
  layout: ReturnType<typeof useLayout>
  browserPanelStacked: PanelGeometry["browserPanelStacked"]
  newSessionDesign: Accessor<boolean>
  desktopSidePanelOpen: PanelGeometry["desktopSidePanelOpen"]
  canReview: Accessor<boolean>
  reviewDiffs: VcsReview["reviewDiffs"]
  reviewReady: VcsReview["reviewReady"]
  reviewEmptyText: Accessor<string>
  hasReview: VcsReview["hasReview"]
  reviewCount: VcsReview["reviewCount"]
  reviewPanel: () => JSX.Element
  reviewPanelV2: () => JSX.Element
  activeReviewFile: VcsReview["activeReviewFile"]
  focusReviewDiff: ReviewDiffScroll["focusReviewDiff"]
  terminalRegionOpen: PanelGeometry["terminalRegionOpen"]
  desktopV2ReviewOpen: PanelGeometry["desktopV2ReviewOpen"]
  desktopFileTreeOpen: PanelGeometry["desktopFileTreeOpen"]
  reviewV2State: ReturnType<typeof createReviewPanelV2State>
  desktopV2PanelLayout: PanelGeometry["desktopV2PanelLayout"]
  terminalOpen: PanelGeometry["terminalOpen"]
  view: ReturnType<typeof useSessionLayout>["view"]
}) {
  return (
    <SessionRouteFrame>
      <SessionHeader />
      <div
        ref={props.bindPanelRow}
        class="flex-1 min-h-0 flex flex-col md:flex-row"
        classList={{
          "gap-2 p-2": props.settings.general.newLayoutDesigns(),
        }}
      >
        <Show when={!props.isDesktop() && props.hasSessionID && !props.settings.general.newLayoutDesigns()}>
          {props.mobileTabs()}
        </Show>

        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
            "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !props.size.active() && !props.reviewSnap && !props.desktopInlineTerminalOnlyOpen(),
          }}
          style={{
            width: props.sessionPanelWidth(),
          }}
        >
          {props.settings.general.newLayoutDesigns() ? (
            <Show when={props.sessionPanelKey()} keyed>
              {(_) => (
                <SessionPanelFrame newLayout raised={props.hasSessionID}>
                  <ErrorBoundary fallback={props.sessionErrorFallback}>{props.sessionPanelContent()}</ErrorBoundary>
                </SessionPanelFrame>
              )}
            </Show>
          ) : (
            <SessionPanelFrame newLayout={false} raised={props.hasSessionID}>
              {props.sessionPanelContent()}
            </SessionPanelFrame>
          )}

          <Show when={props.desktopSessionResizeOpen()}>
            <div onPointerDown={() => props.size.start()}>
              <ResizeHandle
                classList={{
                  "-end-1": props.settings.general.newLayoutDesigns(),
                }}
                direction="horizontal"
                size={props.sessionPanelResizedWidth()}
                min={SESSION_PANEL_WIDTH_MIN}
                max={props.sessionPanelMax()}
                onResize={(width) => {
                  props.size.touch()
                  props.layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <Show when={!props.browserPanelStacked()}>
          <BrowserPanelOverlay />
        </Show>

        <Show when={!props.newSessionDesign() && props.desktopSidePanelOpen()}>
          <Suspense>
            <SessionSidePanel
              canReview={props.canReview}
              diffs={props.reviewDiffs}
              diffsReady={props.reviewReady}
              empty={props.reviewEmptyText}
              hasReview={props.hasReview}
              reviewHasFocusableContent={props.hasReview}
              reviewCount={props.reviewCount}
              reviewPanel={props.reviewPanel}
              activeDiff={props.activeReviewFile()}
              focusReviewDiff={props.focusReviewDiff}
              reviewSnap={props.reviewSnap}
              size={props.size}
            />
          </Suspense>
        </Show>
        <Show when={props.newSessionDesign()}>
          <Show when={props.terminalRegionOpen()}>
            <div class="min-w-0 h-full flex flex-1 flex-col">
              <Show when={props.browserPanelStacked()}>
                <BrowserPanelOverlay stacked />
              </Show>
              <Show when={props.isDesktop() && (props.desktopV2ReviewOpen() || props.desktopFileTreeOpen())}>
                <div class="min-h-0 flex-1">
                  <Suspense>
                    <SessionSidePanel
                      canReview={props.canReview}
                      diffs={props.reviewDiffs}
                      diffsReady={props.reviewReady}
                      empty={props.reviewEmptyText}
                      hasReview={props.hasReview}
                      reviewHasFocusableContent={() => props.hasReview() || props.reviewV2State.sidebarOpened()}
                      reviewCount={props.reviewCount}
                      reviewPanel={props.reviewPanelV2}
                      reviewSidebarToggle={(disabled) => (
                        <SessionReviewV2SidebarToggle
                          opened={props.reviewV2State.sidebarOpened()}
                          disabled={disabled}
                          onToggle={props.reviewV2State.toggleSidebar}
                        />
                      )}
                      fileBrowserState={props.reviewV2State}
                      activeDiff={props.activeReviewFile()}
                      focusReviewDiff={props.focusReviewDiff}
                      reviewSnap={props.reviewSnap}
                      size={props.size}
                      stacked={props.desktopV2PanelLayout().stacked}
                    />
                  </Suspense>
                </div>
              </Show>
              <Show when={props.desktopV2PanelLayout().stacked}>
                <div class="relative h-2 shrink-0" onPointerDown={() => props.size.start()}>
                  <ResizeHandle
                    class="!relative !inset-auto !h-full !w-full !transform-none"
                    direction="vertical"
                    size={props.layout.terminal.height()}
                    min={100}
                    max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                    collapseThreshold={50}
                    onResize={(height) => {
                      props.size.touch()
                      props.layout.terminal.resize(height)
                    }}
                    onCollapse={() => props.view().terminal.close()}
                  />
                </div>
              </Show>
              <Show when={props.terminalOpen()}>
                <div
                  classList={{
                    "min-h-0 shrink-0": props.desktopV2PanelLayout().stacked,
                    "min-h-0 flex-1": !props.desktopV2PanelLayout().stacked,
                  }}
                >
                  <TerminalPanelV2 stacked={props.desktopV2PanelLayout().stacked} />
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={!props.newSessionDesign()}>
        <TerminalPanel />
      </Show>
    </SessionRouteFrame>
  )
}
