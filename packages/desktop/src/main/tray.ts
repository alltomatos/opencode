import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getAutoStartSettings, setAutoStartSettings } from "./auto-start"
import { nativeT } from "./native-translations"
import { getLastFocusedWindow, restoreMainWindows, setAppQuitting } from "./windows"

const root = dirname(fileURLToPath(import.meta.url))
let trayInstance: Tray | null = null

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function getTrayIcon() {
  const ext = process.platform === "win32" ? "ico" : "png"
  const file = join(iconsDir(), `icon.${ext}`)
  const img = nativeImage.createFromPath(file)
  if (process.platform === "win32") {
    return img.resize({ width: 16, height: 16 })
  }
  if (process.platform === "darwin") {
    return img.resize({ width: 18, height: 18 })
  }
  return img.resize({ width: 22, height: 22 })
}

export function showMainWindow() {
  let win = getLastFocusedWindow()
  if (!win || win.isDestroyed()) {
    const wins = restoreMainWindows()
    win = wins[0]
  }
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

export function toggleMainWindow() {
  const win = getLastFocusedWindow()
  if (!win || win.isDestroyed()) {
    showMainWindow()
    return
  }
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

export function updateTrayMenu() {
  if (!trayInstance) return
  const autoStart = getAutoStartSettings()

  const template = [
    {
      label: nativeT("desktop.menu.app") || "OpenCode",
      enabled: false,
    },
    { type: "separator" as const },
    {
      label: nativeT("desktop.menu.window") || "Abrir Janela",
      click: () => showMainWindow(),
    },
    {
      label: nativeT("desktop.menu.newWindow") || "Nova Janela",
      click: () => {
        restoreMainWindows()
      },
    },
    { type: "separator" as const },
    {
      label: "Iniciar com o Sistema",
      type: "checkbox" as const,
      checked: autoStart.openAtLogin,
      click: (item: { checked: boolean }) => {
        setAutoStartSettings({ openAtLogin: item.checked })
        updateTrayMenu()
      },
    },
    {
      label: "Iniciar em Segundo Plano",
      type: "checkbox" as const,
      checked: autoStart.openAsHidden,
      enabled: autoStart.openAtLogin,
      click: (item: { checked: boolean }) => {
        setAutoStartSettings({ openAsHidden: item.checked })
        updateTrayMenu()
      },
    },
    {
      label: "Minimizar para a Bandeja ao Fechar",
      type: "checkbox" as const,
      checked: autoStart.closeToTray,
      click: (item: { checked: boolean }) => {
        setAutoStartSettings({ closeToTray: item.checked })
        updateTrayMenu()
      },
    },
    { type: "separator" as const },
    {
      label: nativeT("desktop.recovery.action.quit") || "Encerrar OpenCode",
      click: () => {
        setAppQuitting(true)
        app.quit()
      },
    },
  ]

  const contextMenu = Menu.buildFromTemplate(template)
  trayInstance.setContextMenu(contextMenu)
}

export function createOrUpdateTray() {
  if (trayInstance) {
    updateTrayMenu()
    return trayInstance
  }

  try {
    const icon = getTrayIcon()
    trayInstance = new Tray(icon)
    trayInstance.setToolTip("OpenCode by Alltomatos")

    trayInstance.on("click", () => {
      showMainWindow()
    })
    trayInstance.on("double-click", () => {
      showMainWindow()
    })

    updateTrayMenu()
  } catch (error) {
    console.warn("Failed to create tray:", error)
  }

  return trayInstance
}

export function destroyTray() {
  if (trayInstance) {
    try {
      trayInstance.destroy()
    } catch {}
    trayInstance = null
  }
}
