import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { SshServerConfig } from "@opencode-ai/app/ssh-tunnel/types"
import type { SshServersController } from "./servers"

function requireString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${label}`)
  return value
}

export function registerSshIpcHandlers(controller: SshServersController) {
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  ipcMain.handle("ssh-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("ssh-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("ssh-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("ssh-servers-get-state", () => controller.getState())
  ipcMain.handle("ssh-servers-list-keys", () => controller.listKeys())
  ipcMain.handle("ssh-servers-add", (_event: IpcMainInvokeEvent, config: Omit<SshServerConfig, "id">) => {
    requireString("host", config?.host)
    requireString("sshUsername", config?.sshUsername)
    requireString("serverUsername", config?.serverUsername)
    return controller.addServer(config)
  })
  ipcMain.handle("ssh-servers-remove", (_event: IpcMainInvokeEvent, id: string) =>
    controller.removeServer(requireString("server id", id)),
  )
  ipcMain.handle("ssh-servers-start", (_event: IpcMainInvokeEvent, id: string) =>
    controller.startServer(requireString("server id", id)),
  )
}
