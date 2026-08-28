import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { createVirtualizer, defaultRangeExtractor, elementScroll, type VirtualItem } from "@tanstack/solid-virtual"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@opencode-ai/session-ui/message-part"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SessionRetry } from "@opencode-ai/session-ui/session-retry"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { TextField } from "@opencode-ai/ui/text-field"
import type {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/core/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { SessionContextUsage } from "@/components/session-context-usage"
import { isBrowserPanelAvailable, isBrowserPanelOpen, toggleBrowserPanel } from "@/components/browser-panel"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionTitle } from "@/utils/session-title"
import { DialogDeleteSession } from "./dialog-delete-session"
import { DialogBackgroundTasks } from "@/components/session/dialog-background-tasks"
import { scheduleConnectedMeasure } from "./measure"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { createTimelineProjection } from "./projection"
import { MessageComment, SummaryDiff, TimelineRow, TimelineRowMap } from "./rows"
import { TimelineThinkingRow, TimelineDiffSummaryRow } from "./timeline-static-rows"
import { createSessionHeaderActions } from "./timeline-session-actions"
import { createScrollAnchor } from "./timeline-scroll-anchor"
import { filterVirtualIndexes } from "./virtual-items"

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "TurnGap" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

const timelineFallbackItemSize = 60
const timelineCache = new Map<string, { measurements: VirtualItem[]; toolOpen: Record<string, boolean | undefined> }>()

const taskDescription = (part: PartType, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

export function MessageTimeline(props: {
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onHistoryScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: () => boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  userMessages: UserMessage[]
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  setHistoryAnchor?: (handlers: { capture: () => void; restore: (done: boolean) => void }) => void
}) {
  const navigate = useNavigate()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const dialog = useDialog()
  const sessionArchive = useSessionArchive()
  const language = useLanguage()
  const { params, sessionKey, view } = useSessionLayout()
  const ownerSessionKey = sessionKey()
  const cached = timelineCache.get(ownerSessionKey)
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && props.shouldAnchorBottom()
  const platform = usePlatform()

  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const sessionID = createMemo(() => params.id)
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync().data.session_status[id] ?? idle
  })
  const sessionMessages = createMemo(() => (sessionID() ? (sync().data.message[sessionID()!] ?? []) : []))
  const projectedMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const visible = new Set(props.userMessages.map((message) => message.id))
    const boundary = sessionMessages().find((message) => message.role === "user" && !visible.has(message.id))?.id
    const messages = sync().data.session_message[id] ?? []
    if (!boundary) return messages
    const index = messages.findIndex((message) => message.id === boundary)
    return index < 0 ? messages : messages.slice(0, index)
  })
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync().session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync().data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync().session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync().data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const getMsgParts = (msgId: string) => sync().data.part[msgId] ?? emptyParts
  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => getMsgParts(message.id))
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !!(titleValue() || parentID()))
  const projection = createTimelineProjection({
    messages: sessionMessages,
    userMessages: () => props.userMessages,
    sessionMessages: projectedMessages,
    parts: getMsgParts,
    status: sessionStatus,
    showReasoningSummaries: settings.general.showReasoningSummaries,
    inlineComments: settings.general.newLayoutDesigns,
  })
  const activeMessageID = projection.activeMessageID
  const assistantMessagesByParent = projection.assistantMessagesByParent
  const lastAssistantGroupKey = projection.lastAssistantGroupKey
  const messageByID = projection.messageByID
  const messageLastRowIndex = projection.messageLastRowIndex
  const messageRowIndex = projection.messageRowIndex
  const timelineRowByKey = projection.rowByKey
  const timelineRows = projection.rows

  const {
    clearPrependAnchor,
    cancelPendingApply,
    capturePrependAnchor,
    restorePrependAnchor,
    handleListWheel,
    handleListTouchStart,
    handleListTouchMove,
    handleListTouchEnd,
    handleListPointerDown,
    handleListPointerMove,
    handleListKeyDown,
    handleListScroll,
  } = createScrollAnchor({
    listRoot,
    onMarkScrollGesture: props.onMarkScrollGesture,
    onScheduleScrollState: props.onScheduleScrollState,
    onHistoryScroll: props.onHistoryScroll,
    hasScrollGesture: props.hasScrollGesture,
    onUserScroll: props.onUserScroll,
    onAutoScrollHandleScroll: props.onAutoScrollHandleScroll,
  })

  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(cached?.toolOpen ?? {})
  const [renderOverscan, setRenderOverscan] = createSignal(initialMeasurements?.length || coldBottomMount ? 6 : 20)
  let resizePinnedIndexes: number[] = []
  let resizePinFrame: number | undefined
  let virtualContent: HTMLDivElement | undefined
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return timelineRows().length
    },
    getScrollElement: () => listRoot() ?? null,
    observeElementOffset: observeElementOffsetReconnectAware,
    initialOffset: () => (props.shouldAnchorBottom() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => timelineFallbackItemSize,
    scrollToFn: (offset, options, instance) => {
      // Expose the computed range before core writes an anchor correction so the browser does not clamp it to the old height.
      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      const rows = timelineRows()
      return (index: number) => {
        const row = rows[index]
        // ResizeObserver can report a removed element after its row has left the projection.
        if (!row) return `removed:${index}`
        return TimelineRow.key(row)
      }
    },
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    get scrollMargin() {
      return showHeader() ? 64 : 0
    },
    overscan: 50,
    paddingEnd: 64,
    rangeExtractor: (range) => {
      const id = activeMessageID()
      const active = id ? (messageLastRowIndex().get(id) ?? -1) : -1
      const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan() })
      return filterVirtualIndexes(
        [...new Set([...resizePinnedIndexes, ...indexes, ...(active < 0 ? [] : [active])])].sort((a, b) => a - b),
        range.count,
      )
    },
  })
  const resizeItem = virtualizer.resizeItem
  let resizeAnchorScheduled = false
  const anchorResizedBottom = () => {
    if (resizeAnchorScheduled || props.hasScrollGesture()) return
    resizeAnchorScheduled = true
    queueMicrotask(() => {
      resizeAnchorScheduled = false
      if (!props.shouldAnchorBottom() || props.hasScrollGesture()) return
      virtualizer.scrollToEnd()
    })
  }
  virtualizer.resizeItem = (index, size) => {
    const item = virtualizer.measurementsCache[index]
    const previous = item ? (virtualizer.itemSizeCache.get(item.key) ?? item.size) : undefined
    const root = listRoot()
    if (root && previous !== undefined && Math.abs(size - previous) > root.clientHeight) {
      const view = root.getBoundingClientRect()
      resizePinnedIndexes = [...root.querySelectorAll<HTMLElement>("[data-index]")]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > view.top && rect.top < view.bottom
        })
        .map((element) => Number(element.dataset.index))
      if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
      resizePinFrame = requestAnimationFrame(() => {
        resizePinFrame = requestAnimationFrame(() => {
          resizePinFrame = undefined
          resizePinnedIndexes = []
        })
      })
    }
    resizeItem(index, size)
    if (root && props.shouldAnchorBottom()) anchorResizedBottom()
  }
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    if (props.shouldAnchorBottom()) return false
    const first = virtualizer.range?.startIndex
    return first !== undefined && item.index < first
  }
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key as string))
  createEffect(() => {
    props.setRevealMessage?.((id) => {
      const index = messageRowIndex().get(id)
      if (index === undefined) return
      virtualizer.scrollToIndex(index, { align: "center" })
    })
    props.setScrollToEnd?.(() => virtualizer.scrollToEnd())
    props.setHistoryAnchor?.({ capture: capturePrependAnchor, restore: restorePrependAnchor })
  })

  let overscanFrame: number | undefined
  onMount(() => {
    overscanFrame = requestAnimationFrame(() => {
      if (props.shouldAnchorBottom()) virtualizer.scrollToEnd()
      overscanFrame = requestAnimationFrame(() => {
        overscanFrame = undefined
        if (renderOverscan() < 20) setRenderOverscan(20)
        if (props.shouldAnchorBottom()) virtualizer.scrollToEnd()
      })
    })
  })

  const maybeAnchorBottom = () => {
    if (timelineRows().length === 0) return
    if (!props.shouldAnchorBottom() || props.hasScrollGesture()) return
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    clearPrependAnchor()
    cancelPendingApply()
    virtualizer.scrollToEnd()
  }

  let measuredSessionKey = sessionKey()
  createEffect(() => {
    const key = sessionKey()
    timelineRows().length
    if (measuredSessionKey !== key) {
      measuredSessionKey = key
      virtualizer.measure()
    }
    maybeAnchorBottom()
  })

  onCleanup(() => {
    clearPrependAnchor()
    timelineCache.delete(ownerSessionKey)
    timelineCache.set(ownerSessionKey, { measurements: virtualizer.takeSnapshot(), toolOpen: { ...toolOpen } })
    while (timelineCache.size > 16) timelineCache.delete(timelineCache.keys().next().value!)
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    if (overscanFrame !== undefined) cancelAnimationFrame(overscanFrame)
    props.setRevealMessage?.(() => {})
    props.setScrollToEnd?.(() => {})
    props.setHistoryAnchor?.({ capture: () => {}, restore: () => {} })
  })

  const {
    title,
    setTitle,
    bindTitleRef,
    share,
    setShare,
    shareMutation,
    unshareMutation,
    titleMutation,
    viewShare,
    shareSession,
    unshareSession,
    copyShareUrl,
    selectShareUrlText,
    openTitleEditor,
    closeTitleEditor,
    saveTitleEditor,
    exportSession,
    deleteSession,
    navigateParent,
  } = createSessionHeaderActions({
    sessionID,
    sessionKey,
    parentID,
    titleLabel,
    shareUrl,
    shareEnabled,
    sync,
    sdk,
    serverSDK,
    platform,
    language,
    sessionArchive,
    navigate,
    params,
  })
  let more: HTMLButtonElement | undefined

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot()) return
    setListRoot(root)
    props.setScrollRef(root)
  }

  onCleanup(() => {
    props.setScrollRef(undefined)
  })

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync().data.message[id] !== undefined) return
        void sync().session.sync(id)
      },
      { defer: true },
    ),
  )

  const workingTurn = (userMessageID: string) => sessionStatus().type !== "idle" && activeMessageID() === userMessageID

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (!message || message.role !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number") return
    if (end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) => {
    if (workingTurn(userMessageID)) return null
    const messages = assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = getMsgParts(message.id)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }
  }

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>, onSizeChange?: () => void) => {
    if (row().group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })
      const contextOpenKey = () => `context:${row().group.key}`
      const open = createMemo(() => {
        return toolOpen[contextOpenKey()] === true
      })

      return (
        <ContextToolGroup
          parts={parts()}
          open={open()}
          onOpenChange={(value) => setToolOpen(contextOpenKey(), value)}
          busy={
            workingTurn(row().userMessageID) && lastAssistantGroupKey().get(row().userMessageID) === row().group.key
          }
          onSizeChange={onSizeChange}
        />
      )
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })
    const defaultOpen = createMemo(() => {
      const item = part()
      if (!item) return
      return partDefaultOpen(item, settings.general.shellToolPartsExpanded(), settings.general.editToolPartsExpanded())
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <MessagePart
                part={part()}
                message={message()}
                showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                turnDurationMs={turnDurationMs(row().userMessageID)}
                useV2Actions={settings.general.newLayoutDesigns()}
                defaultOpen={defaultOpen()}
                toolOpen={toolOpen[part().id] ?? defaultOpen()}
                onToolOpenChange={(open) => setToolOpen(part().id, open)}
                deferToolContent
                virtualizeDiff={false}
                onContentRendered={onSizeChange}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousAssistantPart = () => {
      const row = input.row()
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row().userMessageID) : undefined}
        data-message-id={input.row().userMessageID}
        data-timeline-row={input.row()._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => {
    switch (row()._tag) {
      case "TurnGap":
        return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ms-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div
                        classList={{
                          "shrink-0 max-w-[260px] rounded-[6px] border-border-weak-base bg-background-stronger px-2.5 py-2": true,
                          "border-[0.5px]": settings.general.newLayoutDesigns(),
                          border: !settings.general.newLayoutDesigns(),
                        }}
                      >
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.role === "user") return m
        })
        const messageComments = createMemo(() => {
          if (!settings.general.newLayoutDesigns()) return []
          return getMsgParts(userMessageRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? [])
        })
        return (
          <TimelineRowFrame row={userMessageRow}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message
                      message={message()}
                      parts={getMsgParts(userMessageRow().userMessageID)}
                      actions={props.actions}
                      useV2Actions={settings.general.newLayoutDesigns()}
                      comments={messageComments()}
                    />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div
                data-slot="session-turn-assistant-content"
                aria-hidden={workingTurn(assistantPartRow().userMessageID)}
              >
                {renderAssistantPartGroup(assistantPartRow, onSizeChange)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        const thinkingRow = row as Accessor<TimelineRowByTag<"Thinking">>
        return (
          <TimelineRowFrame row={thinkingRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineThinkingRow
                reasoningHeading={thinkingRow().reasoningHeading}
                showReasoningSummaries={settings.general.showReasoningSummaries()}
                executing={thinkingRow().executing}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry": {
        const retryRow = row as Accessor<TimelineRowByTag<"Retry">>
        return (
          <TimelineRowFrame row={retryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show={activeMessageID() === retryRow().userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        return (
          <TimelineRowFrame row={diffSummaryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={diffSummaryRow().diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <Card variant="error" class="error-card">
                {errorRow().text}
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
    }
  }

  function TimelineRowView(props: { row: TimelineRow.TimelineRow; onSizeChange?: () => void }) {
    return renderTimelineRow(() => props.row, props.onSizeChange)
  }

  function VirtualTimelineRow(props: { rowKey: string }) {
    let element: HTMLDivElement
    const initialItem = virtualItemByKey().get(props.rowKey)!
    const initialRow = timelineRowByKey().get(props.rowKey)!
    const item = createMemo(() => virtualItemByKey().get(props.rowKey) ?? initialItem)
    const row = createMemo(() => timelineRowByKey().get(props.rowKey) ?? initialRow)
    const tool = () => {
      const value = row()
      if (value._tag !== "AssistantPart" || value.group.type !== "part") return
      const part = getMsgPart(value.group.ref.messageID, value.group.ref.partID)
      if (part?.type === "tool") return part
    }
    const asyncFile = () => ["edit", "write", "apply_patch"].includes(tool()?.tool ?? "")
    const [ready, setReady] = createSignal(initialItem.size <= timelineFallbackItemSize || !asyncFile())
    let contentMeasureFrame: number | undefined

    onMount(() => virtualizer.measureElement(element))

    createEffect(
      on(
        () => item().index,
        () => {
          virtualizer.measureElement(element)
        },
        { defer: true },
      ),
    )

    onCleanup(() => {
      if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
    })

    return (
      <div
        data-timeline-key={props.rowKey}
        style={{
          position: "absolute",
          top: `${item().start - (showHeader() ? 64 : 0)}px`,
          left: "0",
          width: "100%",
          height: `${item().size}px`,
          overflow: "clip",
          // Rounded virtual measurements can otherwise clip a framed row's outer paint.
          "overflow-clip-margin": row()._tag === "TurnGap" ? undefined : "0.5px",
        }}
      >
        <div
          ref={(value) => {
            element = value
          }}
          data-index={item().index}
          style={{ "min-height": ready() ? undefined : `${initialItem.size}px` }}
        >
          <TimelineRowView
            row={row()}
            onSizeChange={() => {
              setReady(true)
              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
              contentMeasureFrame = scheduleConnectedMeasure(element, virtualizer.measureElement)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div class="relative w-full h-full min-w-0">
      <div
        class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-all duration-200 ease-out"
        classList={{
          "bottom-8": settings.general.newLayoutDesigns(),
          "bottom-6": !settings.general.newLayoutDesigns(),
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          "scale-[0.8]": (!props.scroll.overflow || !props.scroll.jump) && settings.general.newLayoutDesigns(),
          "scale-95": (!props.scroll.overflow || !props.scroll.jump) && !settings.general.newLayoutDesigns(),
        }}
      >
        <Show
          when={settings.general.newLayoutDesigns()}
          fallback={
            <button
              type="button"
              aria-label={language.t("session.messages.jumpToLatest")}
              class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
              onClick={props.onResumeScroll}
            >
              <div
                class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
                style={{
                  "box-shadow":
                    "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
                }}
              >
                <Icon name="arrow-down-to-line" size="small" />
              </div>
            </button>
          }
        >
          <button
            type="button"
            aria-label={language.t("session.messages.jumpToLatest")}
            class="pointer-events-auto flex items-center justify-center w-8 h-7 px-2 py-1.5 rounded-lg border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px]"
            style={{
              background: "color-mix(in srgb, var(--v2-background-bg-base) 92%, transparent)",
              "box-shadow": "var(--v2-elevation-raised), 0px 2px 8px var(--v2-background-bg-base)",
            }}
            onClick={props.onResumeScroll}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M12.3333 8.66665L8 13L3.66667 8.66665M8 12.6667V2.83332"
                stroke="currentColor"
                stroke-linecap="square"
              />
            </svg>
          </button>
        </Show>
      </div>
      <ScrollView
        viewportRef={bindListRoot}
        onWheel={handleListWheel}
        onTouchStart={handleListTouchStart}
        onTouchMove={handleListTouchMove}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onPointerDown={handleListPointerDown}
        onPointerMove={handleListPointerMove}
        onKeyDown={handleListKeyDown}
        onScroll={handleListScroll}
        onClick={props.onAutoScrollInteraction}
        class="relative min-w-0 w-full h-full"
        style={{
          "--sticky-accordion-top": showHeader() ? "48px" : "0px",
        }}
      >
        <Show when={showHeader()}>
          <div
            data-session-title
            classList={{
              "sticky top-0 z-30": true,
              "bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)]":
                settings.general.newLayoutDesigns(),
              "bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]":
                !settings.general.newLayoutDesigns(),
              "w-full": true,
              "pb-4": true,
              "pr-3": true,
              "pl-2.5": settings.general.newLayoutDesigns(),
              "pl-2 md:pl-4": !settings.general.newLayoutDesigns(),
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered && !settings.general.newLayoutDesigns(),
            }}
          >
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div
                classList={{
                  "flex items-center gap-1 min-w-0 flex-1": true,
                  "pr-3": !settings.general.newLayoutDesigns(),
                }}
              >
                <div class="flex items-center min-w-0 flex-1 w-full">
                  <Show when={parentID()}>
                    <button
                      type="button"
                      data-slot="session-title-parent"
                      class="min-w-0 max-w-[40%] truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                      onClick={navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </Show>
                  <Show when={childTitle() || title.editing}>
                    <Show
                      when={title.editing}
                      fallback={
                        <h1
                          data-slot="session-title-child"
                          classList={{
                            "truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                            "w-fit rounded-[6px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover":
                              settings.general.newLayoutDesigns(),
                            "grow-1 min-w-0": !settings.general.newLayoutDesigns(),
                          }}
                          onClick={openTitleEditor}
                        >
                          {childTitle()}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={bindTitleRef}
                        data-slot="session-title-child"
                        value={title.draft}
                        disabled={titleMutation.isPending}
                        classList={{
                          "block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                          "w-full flex-1 grow-1 min-w-0 pl-1 -ml-1 rounded-[6px]": !settings.general.newLayoutDesigns(),
                          "field-sizing-content self-start rounded-[6px] px-2 py-1 ":
                            settings.general.newLayoutDesigns(),
                        }}
                        style={{
                          "--inline-input-shadow": settings.general.newLayoutDesigns()
                            ? "none"
                            : "var(--shadow-xs-border-select)",
                        }}
                        onInput={(event) => setTitle("draft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeTitleEditor()
                          }
                        }}
                        onBlur={closeTitleEditor}
                      />
                    </Show>
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => (
                  <div
                    classList={{
                      "shrink-0 flex items-center": true,
                      "gap-2": settings.general.newLayoutDesigns(),
                      "gap-3": !settings.general.newLayoutDesigns(),
                    }}
                  >
                    <Show when={platform.platform === "desktop"}>
                      <IconButtonV2
                        type="button"
                        variant="ghost-muted"
                        size="large"
                        state={view().terminal.opened() ? "pressed" : undefined}
                        aria-label={language.t("session.header.open.app.terminal")}
                        aria-pressed={view().terminal.opened()}
                        icon={<Icon name="terminal" />}
                        onClick={() => view().terminal.toggle()}
                      />
                    </Show>
                    <Show when={isBrowserPanelAvailable()}>
                      <IconButtonV2
                        type="button"
                        variant="ghost-muted"
                        size="large"
                        state={isBrowserPanelOpen() ? "pressed" : undefined}
                        aria-label={language.t("browser.panel.toggle")}
                        aria-pressed={isBrowserPanelOpen()}
                        icon={<Icon name="square-arrow-top-right" />}
                        onClick={toggleBrowserPanel}
                      />
                    </Show>
                    <SessionContextUsage
                      placement="bottom"
                      buttonAppearance={settings.general.newLayoutDesigns() ? "v2" : "default"}
                    />
                    <Show when={!parentID()}>
                      <Show
                        when={settings.general.newLayoutDesigns()}
                        fallback={
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={title.menuOpen}
                            onOpenChange={(open) => {
                              setTitle("menuOpen", open)
                              if (open) return
                            }}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                              classList={{
                                "bg-surface-base-active": share.open || title.pendingShare,
                              }}
                              aria-label={language.t("common.moreOptions")}
                              aria-expanded={title.menuOpen || share.open || title.pendingShare}
                              ref={(el: HTMLButtonElement) => {
                                more = el
                              }}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                style={{ "min-width": "104px" }}
                                onCloseAutoFocus={(event) => {
                                  if (title.pendingRename) {
                                    event.preventDefault()
                                    setTitle("pendingRename", false)
                                    openTitleEditor()
                                    return
                                  }
                                  if (title.pendingShare) {
                                    event.preventDefault()
                                    requestAnimationFrame(() => {
                                      setShare({ open: true, dismiss: null })
                                      setTitle("pendingShare", false)
                                    })
                                  }
                                }}
                              >
                                <DropdownMenu.Item
                                  onSelect={() => {
                                    setTitle("pendingRename", true)
                                    setTitle("menuOpen", false)
                                  }}
                                >
                                  <IconV2 name="edit" size="small" />
                                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <Show when={shareEnabled()}>
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      setTitle({ pendingShare: true, menuOpen: false })
                                    }}
                                  >
                                    <IconV2 name="outline-share" size="small" />
                                    <DropdownMenu.ItemLabel>
                                      {language.t("session.share.action.share")}
                                    </DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </Show>
                                <DropdownMenu.Item onSelect={() => exportSession(id)}>
                                  <Icon name="download" size="small" />
                                  <DropdownMenu.ItemLabel>{language.t("common.export")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <DropdownMenu.Item onSelect={() => void sessionArchive.archive(id)}>
                                  <IconV2 name="archive" size="small" />
                                  <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator />
                                <DropdownMenu.Item
                                  class="text-text-on-critical-base hover:bg-surface-critical-weak"
                                  onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} onDelete={deleteSession} />)}
                                >
                                  <Icon name="trash" size="small" />
                                  <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
                        }
                      >
                        <MenuV2
                          gutter={6}
                          placement="bottom-end"
                          open={title.menuOpen}
                          onOpenChange={(open) => {
                            setTitle("menuOpen", open)
                            if (open) return
                          }}
                        >
                          <MenuV2.Trigger
                            as={IconButtonV2}
                            icon={<IconV2 name="outline-dots" />}
                            variant="ghost-muted"
                            size="large"
                            state={share.open || title.pendingShare ? "pressed" : undefined}
                            aria-label={language.t("common.moreOptions")}
                            aria-expanded={title.menuOpen || share.open || title.pendingShare}
                            ref={(el: HTMLButtonElement) => {
                              more = el
                            }}
                          />
                          <MenuV2.Portal>
                            <MenuV2.Content
                              style={{ width: "180px", "min-width": "180px" }}
                              onCloseAutoFocus={(event) => {
                                if (title.pendingRename) {
                                  event.preventDefault()
                                  setTitle("pendingRename", false)
                                  openTitleEditor()
                                  return
                                }
                                if (title.pendingShare) {
                                  event.preventDefault()
                                  requestAnimationFrame(() => {
                                    setShare({ open: true, dismiss: null })
                                    setTitle("pendingShare", false)
                                  })
                                }
                              }}
                            >
                              <MenuV2.Item
                                onSelect={() => {
                                  setTitle("pendingRename", true)
                                  setTitle("menuOpen", false)
                                }}
                              >
                                <IconV2 name="edit" size="small" />
                                {language.t("common.rename")}
                              </MenuV2.Item>
                              <Show when={shareEnabled()}>
                                <MenuV2.Item
                                  onSelect={() => {
                                    setTitle({ pendingShare: true, menuOpen: false })
                                  }}
                                >
                                  <IconV2 name="outline-share" size="small" />
                                  {language.t("session.share.action.share")}...
                                </MenuV2.Item>
                              </Show>
                              <MenuV2.Item onSelect={() => exportSession(id)}>
                                <IconV2 name="outline-square-arrow" size="small" />
                                {language.t("common.export")}...
                              </MenuV2.Item>
                              <MenuV2.Item onSelect={() => void sessionArchive.archive(id)}>
                                <IconV2 name="archive" size="small" />
                                {language.t("common.archive")}
                              </MenuV2.Item>
                              <MenuV2.Item
                                onSelect={() => {
                                  setTitle("menuOpen", false)
                                  dialog.show(() => <DialogBackgroundTasks />)
                                }}
                              >
                                <IconV2 name="grid-plus" size="small" />
                                {language.t("ui.backgroundTasks.title")}
                              </MenuV2.Item>
                              <MenuV2.Separator />
                              <MenuV2.Item
                                class="text-v2-state-fg-danger"
                                onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} onDelete={deleteSession} />)}
                              >
                                <Icon name="trash" size="small" />
                                {language.t("common.delete")}...
                              </MenuV2.Item>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                      </Show>

                      <KobaltePopover
                        open={share.open}
                        anchorRef={() => more}
                        placement="bottom-end"
                        gutter={settings.general.newLayoutDesigns() ? 6 : 4}
                        modal={false}
                        onOpenChange={(open) => {
                          if (open) setShare("dismiss", null)
                          setShare("open", open)
                        }}
                      >
                        <KobaltePopover.Portal>
                          <KobaltePopover.Content
                            data-component="popover-content"
                            classList={{
                              "flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]":
                                settings.general.newLayoutDesigns(),
                            }}
                            style={{ "min-width": "320px" }}
                            onEscapeKeyDown={(event) => {
                              setShare({ dismiss: "escape", open: false })
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onPointerDownOutside={() => {
                              setShare({ dismiss: "outside", open: false })
                            }}
                            onFocusOutside={() => {
                              setShare({ dismiss: "outside", open: false })
                            }}
                            onCloseAutoFocus={(event) => {
                              if (share.dismiss === "outside") event.preventDefault()
                              setShare("dismiss", null)
                            }}
                          >
                            <Show
                              when={settings.general.newLayoutDesigns()}
                              fallback={
                                <div class="flex flex-col p-3">
                                  <div class="flex flex-col gap-1">
                                    <div class="text-13-medium text-text-strong">
                                      {language.t("session.share.popover.title")}
                                    </div>
                                    <div class="text-12-regular text-text-weak">
                                      {shareUrl()
                                        ? language.t("session.share.popover.description.shared")
                                        : language.t("session.share.popover.description.unshared")}
                                    </div>
                                  </div>
                                  <div class="mt-3 flex flex-col gap-2">
                                    <Show
                                      when={shareUrl()}
                                      fallback={
                                        <Button
                                          size="large"
                                          variant="primary"
                                          class="w-full"
                                          onClick={shareSession}
                                          disabled={shareMutation.isPending}
                                        >
                                          {shareMutation.isPending
                                            ? language.t("session.share.action.publishing")
                                            : language.t("session.share.action.publish")}
                                        </Button>
                                      }
                                    >
                                      <div class="flex flex-col gap-2">
                                        <TextField
                                          value={shareUrl() ?? ""}
                                          readOnly
                                          copyable
                                          copyKind="link"
                                          tabIndex={-1}
                                          class="w-full"
                                        />
                                        <div class="grid grid-cols-2 gap-2">
                                          <Button
                                            size="large"
                                            variant="secondary"
                                            class="w-full shadow-none border border-border-weak-base"
                                            onClick={unshareSession}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {unshareMutation.isPending
                                              ? language.t("session.share.action.unpublishing")
                                              : language.t("session.share.action.unpublish")}
                                          </Button>
                                          <Button
                                            size="large"
                                            variant="primary"
                                            class="w-full"
                                            onClick={viewShare}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {language.t("session.share.action.view")}
                                          </Button>
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              }
                            >
                              <div class="flex w-full flex-col gap-1.5 px-0.5 pt-0.5">
                                <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
                                  {language.t("session.share.popover.title")}
                                </div>
                                <div class="select-none text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-variation-settings:'slnt'_0]">
                                  {shareUrl()
                                    ? language.t("session.share.popover.description.shared")
                                    : language.t("session.share.popover.description.unshared")}
                                </div>
                              </div>
                              <div class="flex w-full flex-col gap-2">
                                <Show
                                  when={shareUrl()}
                                  fallback={
                                    <ButtonV2
                                      variant="contrast"
                                      class="w-full"
                                      onClick={shareSession}
                                      disabled={shareMutation.isPending}
                                    >
                                      {shareMutation.isPending
                                        ? language.t("session.share.action.publishing")
                                        : language.t("session.share.action.publish")}
                                    </ButtonV2>
                                  }
                                >
                                  <div class="flex flex-col gap-2">
                                    <div
                                      class="flex h-8 w-full items-center gap-1.5 rounded-[6px] py-1 pl-2.5 pr-1.5 shadow-[var(--v2-elevation-button-neutral)]"
                                      style={{
                                        background:
                                          "linear-gradient(180deg, var(--v2-alpha-light-2) 0%, var(--v2-alpha-light-0) 100%), var(--v2-background-bg-button-neutral)",
                                      }}
                                    >
                                      <div
                                        class="min-w-0 flex-1 truncate select-text cursor-text text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]"
                                        onClick={selectShareUrlText}
                                      >
                                        {shareUrl()}
                                      </div>
                                      <IconButtonV2
                                        type="button"
                                        size="small"
                                        variant="ghost-muted"
                                        icon={<IconV2 name="outline-copy" />}
                                        aria-label={language.t("session.share.copy.copyLink")}
                                        onClick={copyShareUrl}
                                      />
                                      <IconButtonV2
                                        type="button"
                                        size="small"
                                        variant="ghost-muted"
                                        icon={<IconV2 name="outline-square-arrow" />}
                                        aria-label={language.t("session.share.action.view")}
                                        onClick={viewShare}
                                        disabled={unshareMutation.isPending}
                                      />
                                    </div>
                                    <div class="flex w-full">
                                      <ButtonV2
                                        variant="outline"
                                        class="w-full"
                                        onClick={unshareSession}
                                        disabled={unshareMutation.isPending}
                                      >
                                        {unshareMutation.isPending
                                          ? language.t("session.share.action.unpublishing")
                                          : language.t("session.share.action.unpublish")}
                                      </ButtonV2>
                                    </div>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </KobaltePopover.Content>
                        </KobaltePopover.Portal>
                      </KobaltePopover>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>
        <div
          data-timeline-virtual-content
          ref={(element) => {
            virtualContent = element
            props.setContentRef(element)
          }}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={virtualRowKeys()}>{(rowKey) => <VirtualTimelineRow rowKey={rowKey} />}</For>
          <Show when={timelineRows().length > 0}>
            <div
              data-timeline-row="bottom-spacer"
              aria-hidden="true"
              class="h-16 absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualizer.getTotalSize() - 64}px)` }}
            />
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
