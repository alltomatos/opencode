import { ServerConnection } from "@/context/server"
import type { Platform } from "@/context/platform"

export function directoryPickerKind(platform: Platform["platform"], server?: ServerConnection.Any) {
  if (platform === "desktop" && !!server && ServerConnection.builtin(server)) return "native" as const
  return "server" as const
}
