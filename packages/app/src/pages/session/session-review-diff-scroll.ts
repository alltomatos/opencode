import { createEffect } from "solid-js"
import { checksum } from "@opencode-ai/core/util/encode"
import type { useSessionLayout } from "@/pages/session/session-layout"

type TreeStore = { reviewScroll: HTMLDivElement | undefined; pendingDiff: string | undefined }

/**
 * Owns scrolling the review panel to a specific diff's row: computing its
 * DOM id/offset, scrolling to it, and retrying across frames (via
 * `pendingDiff`) until the row is actually mounted and the scroll settles —
 * needed because the review panel content isn't always mounted yet when a
 * diff is requested (e.g. right after opening the panel).
 */
export function createReviewDiffScroll(deps: {
  tree: TreeStore
  setTree: (...args: any[]) => void
  view: ReturnType<typeof useSessionLayout>["view"]
  openReviewPanel: () => void
  reviewReady: () => boolean
}) {
  const { tree, setTree, view, openReviewPanel, reviewReady } = deps

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    view().review.setFile(path)
    setTree("pendingDiff", path)
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  return { reviewDiffId, reviewDiffTop, scrollToReviewDiff, focusReviewDiff }
}
