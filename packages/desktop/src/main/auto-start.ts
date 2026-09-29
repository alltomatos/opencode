import { app, BrowserWindow } from "electron"
import { getStore } from "./store"
import { AUTO_START_ENABLED_KEY, AUTO_START_HIDDEN_KEY, CLOSE_TO_TRAY_KEY } from "./store-keys"

export type AutoStartSettings = {
  openAtLogin: boolean
  openAsHidden: boolean
  closeToTray: boolean
}

export function getAutoStartSettings(): AutoStartSettings {
  const store = getStore()
  let openAtLogin = store.get(AUTO_START_ENABLED_KEY)
  if (typeof openAtLogin !== "boolean") {
    try {
      openAtLogin = app.getLoginItemSettings().openAtLogin
    } catch {
      openAtLogin = false
    }
  }

  const openAsHidden = store.get(AUTO_START_HIDDEN_KEY) === true
  let closeToTray = store.get(CLOSE_TO_TRAY_KEY)
  if (typeof closeToTray !== "boolean") {
    closeToTray = openAsHidden || false
  }

  return {
    openAtLogin: Boolean(openAtLogin),
    openAsHidden: Boolean(openAsHidden),
    closeToTray: Boolean(closeToTray),
  }
}

export function setAutoStartSettings(settings: Partial<AutoStartSettings>): AutoStartSettings {
  const store = getStore()
  const current = getAutoStartSettings()
  const next: AutoStartSettings = {
    openAtLogin: settings.openAtLogin ?? current.openAtLogin,
    openAsHidden: settings.openAsHidden ?? current.openAsHidden,
    closeToTray: settings.closeToTray ?? current.closeToTray,
  }

  store.set(AUTO_START_ENABLED_KEY, next.openAtLogin)
  store.set(AUTO_START_HIDDEN_KEY, next.openAsHidden)
  store.set(CLOSE_TO_TRAY_KEY, next.closeToTray)

  try {
    app.setLoginItemSettings({
      openAtLogin: next.openAtLogin,
      openAsHidden: next.openAsHidden,
      args: next.openAsHidden ? ["--hidden"] : [],
    })
  } catch (error) {
    console.warn("Failed to update login item settings:", error)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("auto-start-settings-changed", next)
    }
  }

  return next
}

export function getCloseToTray(): boolean {
  const settings = getAutoStartSettings()
  return settings.closeToTray
}
