import { canNavigateHistoryAtCursor } from "./history"

type CaretState = { collapsed: boolean; cursorPosition: number; textLength: number }

/**
 * Owns keydown handling for the prompt editor and the slash-menu popover.
 * Pure event-routing logic — every side effect (mode switches, popover
 * state, submit/abort) is delegated back through the deps object so this
 * module has no knowledge of the component's signals.
 */
export function createKeyboardHandlers(deps: {
  editor: () => HTMLDivElement
  getCursorPosition: (el: HTMLDivElement) => number
  mode: () => "normal" | "shell"
  setMode: (mode: "normal" | "shell") => void
  popover: () => "at" | "slash" | null
  closePopover: () => void
  escBlur: () => boolean
  working: () => boolean
  abort: () => Promise<void> | void
  getCaretState: () => CaretState
  pick: () => void
  addPart: (part: { type: "text"; content: string; start: number; end: number }) => void
  isImeComposing: (event: KeyboardEvent) => boolean
  atOnKeyDown: (event: KeyboardEvent) => void
  slashOnKeyDown: (event: KeyboardEvent) => void
  selectPopoverActive: () => void
  scrollSlashActiveIntoView: () => void
  promptText: () => string
  historyIndex: () => number
  navigateHistory: (direction: "up" | "down") => boolean
  imageAttachmentCount: () => number
  commentCount: () => number
  handleSubmit: (event: Event) => Promise<void> | void
}) {
  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (deps.mode() !== "normal") return
      deps.pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && deps.mode() === "normal") {
      const cursorPosition = deps.getCursorPosition(deps.editor())
      if (cursorPosition === 0) {
        deps.setMode("shell")
        deps.closePopover()
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (deps.popover()) {
        deps.closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.mode() === "shell") {
        deps.setMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.working()) {
        void deps.abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (deps.escBlur()) {
        deps.editor().blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (deps.mode() === "shell") {
      const { collapsed, cursorPosition, textLength } = deps.getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        deps.setMode("normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      deps.addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && deps.isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (deps.popover()) {
      if (event.key === "Tab") {
        deps.selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (deps.popover() === "at") {
          deps.atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (deps.popover() === "slash") {
          deps.slashOnKeyDown(event)
          if (event.key === "ArrowUp" || event.key === "ArrowDown" || ctrlNav) {
            deps.scrollSlashActiveIntoView()
          }
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (deps.popover()) {
        deps.closePopover()
        event.preventDefault()
        return
      }
      if (deps.working()) {
        void deps.abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = deps.getCaretState()
      if (!collapsed) return

      const cursorPosition = deps.getCursorPosition(deps.editor())
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, deps.promptText(), cursorPosition, deps.historyIndex() >= 0)) return
      if (deps.navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      if (
        deps.working() &&
        deps.promptText().trim().length === 0 &&
        deps.imageAttachmentCount() === 0 &&
        deps.commentCount() === 0
      ) {
        return
      }
      void deps.handleSubmit(event)
    }
  }

  const handleSlashMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      deps.closePopover()
      requestAnimationFrame(() => deps.editor().focus())
      event.preventDefault()
      return
    }

    if (event.key === "Tab") {
      deps.selectPopoverActive()
      event.preventDefault()
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
    const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
    if (!nav && !ctrlNav) return
    deps.slashOnKeyDown(event)
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || ctrlNav) deps.scrollSlashActiveIntoView()
    event.preventDefault()
  }

  return { handleKeyDown, handleSlashMenuKeyDown }
}
