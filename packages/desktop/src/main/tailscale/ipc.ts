import { ipcMain } from "electron"
import { checkTailscale } from "./check"

export function registerTailscaleIpcHandlers() {
  ipcMain.handle("tailscale-check", () => checkTailscale())
}
