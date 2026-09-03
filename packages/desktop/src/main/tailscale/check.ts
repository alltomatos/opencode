import { spawn } from "node:child_process"

export type TailscaleStatus = { available: boolean; ip: string | null }

// `tailscale ip -4` only succeeds when the daemon is running and this
// machine is actually joined to a tailnet — exactly what we need to know
// before offering the VPS's Tailscale address as a connection option.
export function checkTailscale(): Promise<TailscaleStatus> {
  return new Promise((resolve) => {
    let out = ""
    let child: ReturnType<typeof spawn>
    try {
      child = spawn("tailscale", ["ip", "-4"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      resolve({ available: false, ip: null })
      return
    }
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()))
    child.once("error", () => resolve({ available: false, ip: null }))
    child.once("exit", (code) => {
      const ip = out.trim().split(/\r?\n/)[0] ?? ""
      resolve(code === 0 && ip ? { available: true, ip } : { available: false, ip: null })
    })
  })
}
