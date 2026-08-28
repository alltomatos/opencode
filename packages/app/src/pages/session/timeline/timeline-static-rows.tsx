import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { Accordion } from "@opencode-ai/ui/accordion"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Icon } from "@opencode-ai/ui/icon"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { normalize } from "@opencode-ai/session-ui/session-diff"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { useLanguage } from "@/context/language"
import type { SummaryDiff } from "./rows"

/**
 * Standalone timeline row renderers with no closure over MessageTimeline's
 * internals — safe to render anywhere given only their own props.
 */
export function ThinkingFaceIcon() {
  return (
    <div class="thinking-face-icon size-10 shrink-0">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="size-full">
        {/* face */}
        <circle cx="12" cy="12" r="9.5" fill="#FFCC4D" stroke="#E8A500" stroke-width="0.5" />
        {/* eyebrows: left flat, right raised — the asymmetry reads as "considering" */}
        <path d="M7.4 9.2L10 8.9" stroke="#664500" stroke-width="1.1" stroke-linecap="round" />
        <path
          class="thinking-face-eyebrow"
          d="M13.9 8.1C14.7 7.2 16 6.9 17 7.4"
          stroke="#664500"
          stroke-width="1.1"
          stroke-linecap="round"
        />
        {/* eyes */}
        <circle cx="9.2" cy="11.4" r="0.95" fill="#664500" />
        <circle cx="14.9" cy="10.9" r="0.95" fill="#664500" />
        {/* small, off-centered pursed mouth */}
        <path d="M9.3 16.2C10.9 15.8 12.7 15.8 14.1 16.2" stroke="#664500" stroke-width="1.1" stroke-linecap="round" />
      </svg>
    </div>
  )
}

export function TimelineThinkingRow(props: {
  reasoningHeading?: string
  showReasoningSummaries: boolean
  executing: boolean
}) {
  const language = useLanguage()
  const statusKey = () => (props.executing ? "ui.sessionTurn.status.runningCommands" : "ui.sessionTurn.status.thinking")

  return (
    <div data-slot="session-turn-thinking">
      <ThinkingFaceIcon />
      <TextShimmer text={`${language.t(statusKey())}...`} />
      <Show when={!props.executing && !props.showReasoningSummaries}>
        <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" travel={25} duration={700} />
      </Show>
    </div>
  )
}

export function TimelineDiffSummaryRow(props: { diffs: SummaryDiff[] }) {
  const language = useLanguage()
  const maxFiles = 10
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, props.diffs.length - maxFiles))
  const visible = createMemo(() => (showAll() ? props.diffs : props.diffs.slice(0, maxFiles)))

  return (
    <div
      data-slot="session-turn-diffs"
      data-component="session-turn-diffs-group"
      data-show-all={showAll() || undefined}
    >
      <div data-slot="session-turn-diffs-header">
        <span data-slot="session-turn-diffs-label">
          {language.plural("ui.sessionTurn.diffs.changed", props.diffs.length)}
        </span>
        <DiffChanges changes={props.diffs} />
        <Show when={overflow() > 0}>
          <span data-slot="session-turn-diffs-toggle" onClick={() => setState("showAll", !showAll())}>
            {showAll() ? language.t("ui.sessionTurn.diffs.showLess") : language.t("ui.sessionTurn.diffs.showAll")}
          </span>
        </Show>
      </div>
      <div data-component="session-turn-diffs-content">
        <Accordion
          multiple
          style={{ "--sticky-accordion-offset": "44px" }}
          value={expanded()}
          onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
        >
          <For each={visible()}>
            {(diff) => {
              const opened = createMemo(() => expanded().includes(diff.file))

              return (
                <Accordion.Item value={diff.file}>
                  <StickyAccordionHeader>
                    <Accordion.Trigger>
                      <div data-slot="session-turn-diff-trigger">
                        <span data-slot="session-turn-diff-path">
                          <Show when={diff.file.includes("/")}>
                            <span data-slot="session-turn-diff-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                          </Show>
                          <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                        </span>
                        <div data-slot="session-turn-diff-meta">
                          <span data-slot="session-turn-diff-changes">
                            <DiffChanges changes={diff} />
                          </span>
                          <span data-slot="session-turn-diff-chevron">
                            <Icon name="chevron-down" size="small" />
                          </span>
                        </div>
                      </div>
                    </Accordion.Trigger>
                  </StickyAccordionHeader>
                  <Accordion.Content>
                    <Show when={opened()}>
                      <TimelineDiffView diff={diff} />
                    </Show>
                  </Accordion.Content>
                </Accordion.Item>
              )
            }}
          </For>
        </Accordion>
        <Show when={!showAll() && overflow() > 0}>
          <div data-slot="session-turn-diffs-more" onClick={() => setState("showAll", true)}>
            {language.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
          </div>
        </Show>
      </div>
    </div>
  )
}

export function TimelineDiffView(props: { diff: SummaryDiff }) {
  const fileComponent = useFileComponent()
  const view = normalize(props.diff)

  return (
    <div data-slot="session-turn-diff-view" data-scrollable>
      <Dynamic component={fileComponent} mode="diff" virtualize={false} fileDiff={view.fileDiff} />
    </div>
  )
}
