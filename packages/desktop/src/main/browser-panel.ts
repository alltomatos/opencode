import { BrowserWindow, WebContentsView } from "electron"
import { write as writeLog } from "./logging"

export type PanelBounds = { x: number; y: number; width: number; height: number }

export type PanelState = {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type BrowserPanel = {
  view: WebContentsView
  setBounds(rect: PanelBounds | null): void
  toggle(visible?: boolean): boolean
  isVisible(): boolean
  navigate(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  state(): PanelState
  attachDebugger(): Promise<void>
  sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  destroy(): void
}

const panels = new WeakMap<BrowserWindow, BrowserPanel>()
// v1 targets a single active panel regardless of window count — the bridge
// addresses panels by a fixed "main" id, so the last-created panel wins.
let activePanel: BrowserPanel | undefined

export function createBrowserPanel(
  win: BrowserWindow,
  onStateChanged: (state: PanelState) => void,
): BrowserPanel {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  view.setVisible(false)

  let visible = false
  let lastBounds: PanelBounds | null = null
  let debuggerState: "detached" | "attaching" | "attached" = "detached"

  const emitState = () => onStateChanged(state())

  function state(): PanelState {
    const wc = view.webContents
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    }
  }

  view.webContents.on("did-navigate", emitState)
  view.webContents.on("did-navigate-in-page", emitState)
  view.webContents.on("page-title-updated", emitState)
  view.webContents.on("did-start-loading", emitState)
  view.webContents.on("did-stop-loading", emitState)

  view.webContents.debugger.on("detach", (_event, reason) => {
    writeLog("browser-panel", `debugger detached: ${reason}`)
    debuggerState = "detached"
  })

  async function attachDebugger() {
    if (debuggerState === "attached") return
    if (debuggerState === "attaching") {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (debuggerState !== "attaching") {
            clearInterval(check)
            resolve()
          }
        }, 20)
      })
      return
    }
    debuggerState = "attaching"
    try {
      if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3")
      await view.webContents.debugger.sendCommand("Page.enable")
      await view.webContents.debugger.sendCommand("DOM.enable")
      await view.webContents.debugger.sendCommand("Accessibility.enable")
      debuggerState = "attached"
    } catch (error) {
      debuggerState = "detached"
      throw error
    }
  }

  async function sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    await attachDebugger()
    return (await view.webContents.debugger.sendCommand(method, params)) as T
  }

  const panel: BrowserPanel = {
    view,
    setBounds(rect) {
      lastBounds = rect
      if (!visible || !rect) {
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        return
      }
      view.setBounds({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      })
    },
    toggle(next) {
      visible = next ?? !visible
      view.setVisible(visible)
      panel.setBounds(lastBounds)
      return visible
    },
    isVisible() {
      return visible
    },
    async navigate(url) {
      await view.webContents.loadURL(url)
    },
    goBack() {
      if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
    },
    goForward() {
      if (view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
    },
    reload() {
      view.webContents.reload()
    },
    state,
    attachDebugger,
    sendCommand,
    destroy() {
      try {
        if (view.webContents.debugger.isAttached()) view.webContents.debugger.detach()
      } catch (error) {
        writeLog("browser-panel", `detach on destroy failed: ${String(error)}`, undefined, "warn")
      }
      try {
        win.contentView.removeChildView(view)
      } catch {
        // window may already be destroyed
      }
      if (activePanel === panel) activePanel = undefined
    },
  }

  panels.set(win, panel)
  activePanel = panel
  return panel
}

export function getBrowserPanel(win: BrowserWindow): BrowserPanel | undefined {
  return panels.get(win)
}

export function getActiveBrowserPanel(): BrowserPanel | undefined {
  return activePanel
}
