import { DEFAULT_PROMPT, type FileAttachmentPart, type AgentPart, type Prompt } from "@/context/prompt"
import { createTextFragment, getCursorPosition, setCursorPosition } from "./editor-dom"

/**
 * Owns the contenteditable <-> Prompt reconciliation: rendering parts into
 * DOM nodes, parsing DOM back into parts, and deciding whether a render is
 * needed at all (mirror-input short-circuit + structural-equality checks).
 */
export function createEditorReconciler(deps: { editor: () => HTMLDivElement; mirror: { input: boolean } }) {
  const { editor, mirror } = deps

  const clearEditor = () => {
    editor().innerHTML = ""
  }

  const currentCursor = () => {
    const selection = window.getSelection()
    const el = editor()
    if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) return null
    return getCursorPosition(el)
  }

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") {
      pill.setAttribute("data-path", part.path)
      if (part.mime) pill.setAttribute("data-mime", part.mime)
      if (part.filename) pill.setAttribute("data-filename", part.filename)
      if (part.url) pill.setAttribute("data-url", part.url)
      if (part.source?.type === "resource") {
        pill.setAttribute("data-source-type", part.source.type)
        pill.setAttribute("data-source-client-name", part.source.clientName)
        pill.setAttribute("data-source-uri", part.source.uri)
      }
    }
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const isNormalizedEditor = () =>
    Array.from(editor().childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ""
        if (!text.includes("\u200B")) return true
        if (text !== "\u200B") return false

        const prev = node.previousSibling
        const next = node.nextSibling
        const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
        return !!prevIsBr && !next
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    const el = editor()
    clearEditor()
    for (const part of parts) {
      if (part.type === "text") {
        el.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        el.appendChild(createPill(part))
      }
    }

    const last = el.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      el.appendChild(document.createTextNode("\u200B"))
    }
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderEditor(parts)
    if (cursor !== null) setCursorPosition(editor(), cursor)
  }

  const parseFromDOM = (): Prompt => {
    const el = editor()
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      let content = buffer
      if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
      if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      const source =
        file.dataset.sourceType === "resource" && file.dataset.sourceClientName && file.dataset.sourceUri
          ? {
              type: "resource" as const,
              text: {
                value: content,
                start: position,
                end: position + content.length,
              },
              clientName: file.dataset.sourceClientName,
              uri: file.dataset.sourceUri,
            }
          : undefined
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
        ...(file.dataset.mime ? { mime: file.dataset.mime } : {}),
        ...(file.dataset.filename ? { filename: file.dataset.filename } : {}),
        ...(file.dataset.url ? { url: file.dataset.url } : {}),
        ...(source ? { source } : {}),
      })
      position += content.length
    }

    const pushAgent = (agent: HTMLElement) => {
      const content = agent.textContent ?? ""
      parts.push({
        type: "agent",
        name: agent.dataset.name!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const child = node as HTMLElement
      if (child.dataset.type === "file") {
        flushText()
        pushFile(child)
        return
      }
      if (child.dataset.type === "agent") {
        flushText()
        pushAgent(child)
        return
      }
      if (child.tagName === "BR") {
        buffer += "\n"
        return
      }

      for (const grandchild of Array.from(child.childNodes)) {
        visit(grandchild)
      }
    }

    const children = Array.from(el.childNodes)
    children.forEach((child, index) => {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
      visit(child)
      if (isBlock && index < children.length - 1) {
        buffer += "\n"
      }
    })

    flushText()

    if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
    return parts
  }

  const reconcile = (input: Prompt, isPromptEqual: (a: Prompt, b: Prompt) => boolean) => {
    if (mirror.input) {
      mirror.input = false
      if (isNormalizedEditor()) return

      renderEditorWithCursor(input)
      return
    }

    const dom = parseFromDOM()
    if (isNormalizedEditor() && isPromptEqual(input, dom)) return

    renderEditorWithCursor(input)
  }

  return {
    clearEditor,
    currentCursor,
    createPill,
    isNormalizedEditor,
    renderEditor,
    renderEditorWithCursor,
    parseFromDOM,
    reconcile,
  }
}
