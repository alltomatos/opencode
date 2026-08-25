import { BrowserWindow } from "electron"
import { getStore } from "./store"
import { COMPUTER_USE_ENABLED_KEY } from "./store-keys"

// On by default (opt-out via Settings > Experimental), same as the browser
// tool: every action still requires ctx.ask permission before it fires, so
// the meaningful gate is the per-action confirm, not whether the bridge is
// running. Read at boot by spawnLocalServer (server.ts), same
// restart-required contract as debug mode's remote-debugging-port switch.
export function getComputerUseEnabled() {
  return getStore().get(COMPUTER_USE_ENABLED_KEY) !== false
}

export function setComputerUseEnabled(enabled: boolean) {
  getStore().set(COMPUTER_USE_ENABLED_KEY, enabled)
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("computer-use-enabled-changed", enabled)
}
