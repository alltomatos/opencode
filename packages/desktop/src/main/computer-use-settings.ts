import { BrowserWindow } from "electron"
import { getStore } from "./store"
import { COMPUTER_USE_ENABLED_KEY } from "./store-keys"

// Off by default, unlike the browser tool: that one is sandboxed to an
// embedded BrowserView the user can see and it's gated on a per-navigation
// confirm; this one drives the whole OS (any window, any app) via the
// platform's own input-automation primitive, so it needs an explicit,
// deliberate opt-in rather than being on the moment the desktop app starts.
// Read at boot by spawnLocalServer (server.ts), same restart-required
// contract as debug mode's remote-debugging-port switch.
export function getComputerUseEnabled() {
  return getStore().get(COMPUTER_USE_ENABLED_KEY) === true
}

export function setComputerUseEnabled(enabled: boolean) {
  getStore().set(COMPUTER_USE_ENABLED_KEY, enabled)
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("computer-use-enabled-changed", enabled)
}
