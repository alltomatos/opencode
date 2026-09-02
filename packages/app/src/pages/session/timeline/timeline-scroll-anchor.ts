import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode-ai/ui/scroll-view"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

/**
 * Owns two intertwined concerns that only make sense together: keeping the
 * scroll position stable while history prepends above the viewport (capture
 * an anchor row before the prepend, correct scrollTop toward it for a few
 * frames after), and the list's raw wheel/touch/pointer/keyboard listeners
 * that decide whether a scroll movement counts as a user gesture (which
 * cancels any pending anchor correction — the user takes over).
 */
export function createScrollAnchor(deps: {
  listRoot: () => HTMLDivElement | undefined
  onMarkScrollGesture: (target?: EventTarget | null) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onHistoryScroll: () => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onAutoScrollHandleScroll: () => void
}) {
  const { listRoot, onMarkScrollGesture, onScheduleScrollState, onHistoryScroll, hasScrollGesture, onUserScroll, onAutoScrollHandleScroll } =
    deps

  let touchGesture: number | undefined
  let prependAnchor: { key: string; offset: number } | undefined
  let prependAnchorFrame: number | undefined
  let prependLoading = false

  const cancelPendingApply = () => {
    if (prependAnchorFrame === undefined) return
    cancelAnimationFrame(prependAnchorFrame)
    prependAnchorFrame = undefined
  }

  const clearPrependAnchor = () => {
    prependLoading = false
    prependAnchor = undefined
    cancelPendingApply()
  }

  const updatePrependAnchor = () => {
    const root = listRoot()
    if (!root) return
    const view = root.getBoundingClientRect()
    const anchor = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
      .sort((a, b) => a.rect.top - b.rect.top)[0]
    if (!anchor) return
    if (!anchor.element.dataset.timelineKey) return
    prependAnchor = { key: anchor.element.dataset.timelineKey, offset: anchor.rect.top - view.top }
  }

  const capturePrependAnchor = () => {
    prependLoading = true
    updatePrependAnchor()
  }

  const applyPrependAnchor = () => {
    const root = listRoot()
    if (!root || !prependAnchor) return
    cancelPendingApply()
    let frames = 0
    let stable = 0
    const apply = () => {
      prependAnchorFrame = undefined
      const anchor = prependAnchor
      if (!anchor) return
      const element = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.key)}"]`)
      const delta = element
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset
        : undefined
      if (delta !== undefined && Math.abs(delta) > 0.5) {
        root.scrollTop += delta
        stable = 0
      } else {
        stable += 1
      }
      frames += 1
      if (stable >= 30 || frames >= 180) {
        if (!prependLoading) prependAnchor = undefined
        return
      }
      prependAnchorFrame = requestAnimationFrame(apply)
    }
    prependAnchorFrame = requestAnimationFrame(apply)
  }

  const restorePrependAnchor = (done: boolean) => {
    if (done) prependLoading = false
    applyPrependAnchor()
  }

  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    const root = event.currentTarget
    const delta = normalizeWheelDelta({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      rootHeight: root.clientHeight,
    })
    if (!delta) return
    markBoundaryGesture({ root, target: event.target, delta, onMarkScrollGesture })
  }

  const handleListTouchStart = (event: TouchEvent) => {
    if (!prependLoading) clearPrependAnchor()
    touchGesture = event.touches[0]?.clientY
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const next = event.touches[0]?.clientY
    const prev = touchGesture
    touchGesture = next
    if (next === undefined || prev === undefined) return

    const delta = prev - next
    if (!delta) return

    markBoundaryGesture({
      root: event.currentTarget,
      target: event.target,
      delta,
      onMarkScrollGesture,
    })
  }

  const handleListTouchEnd = () => {
    touchGesture = undefined
  }

  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    onMarkScrollGesture(event.target)
  }

  const handleListPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 1) return
    onMarkScrollGesture(event.target)
  }

  const handleListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const key = scrollKey(event)
    if (!key) return
    if (!isScrollKeyTarget(event.target, key)) return
    if (scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget) return
    if (!prependLoading) clearPrependAnchor()
    onMarkScrollGesture(event.currentTarget)
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (prependLoading) updatePrependAnchor()
    onScheduleScrollState(event.currentTarget)
    onHistoryScroll()
    if (!hasScrollGesture()) return
    onUserScroll()
    onAutoScrollHandleScroll()
    onMarkScrollGesture(event.currentTarget)
  }

  return {
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
  }
}
