import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode-ai/ui/scroll-view"
import { setCursorPosition } from "@/components/prompt-input/editor-dom"
import { promptLength } from "@/components/prompt-input/history"
import type { usePrompt } from "@/context/prompt"

const isEditableTarget = (target: EventTarget | null | undefined) => {
  if (!(target instanceof HTMLElement)) return false
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
}

const deepActiveElement = () => {
  let current: Element | null = document.activeElement
  while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement
  }
  return current instanceof HTMLElement ? current : undefined
}

/**
 * Document-level keydown listener: forwards a scroll-key press to the
 * message list when it owns focus, and auto-focuses the composer when the
 * user starts typing anywhere else on the page (unless something editable
 * or explicitly focus-protected already has focus).
 */
export function createGlobalKeydownHandler(deps: {
  inputRef: () => HTMLDivElement | undefined
  scroller: () => HTMLDivElement | undefined
  markScrollGesture: (target?: EventTarget | null) => void
  dialogActive: () => unknown
  composerBlocked: () => boolean
  isChildSession: () => boolean
  prompt: ReturnType<typeof usePrompt>
}) {
  const { inputRef, scroller, markScrollGesture, dialogActive, composerBlocked, isChildSession, prompt } = deps

  return (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialogActive()) return

    const input = inputRef()
    if (activeElement === input) {
      if (event.key === "Escape") input?.blur()
      return
    }

    const key = scrollKey(event)
    if (key) {
      const scrollerEl = scroller()
      if (!scrollerEl || !isScrollKeyTarget(target ?? null, key)) return
      if (scrollKeyOwner(scrollerEl, target ?? null, key) !== scrollerEl) return
      markScrollGesture(scrollerEl)
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composerBlocked() || isChildSession()) return
      if (!input) return
      input.focus()
      setCursorPosition(input, prompt.cursor() ?? promptLength(prompt.current()))
    }
  }
}
