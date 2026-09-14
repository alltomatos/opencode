import { describe, expect, test } from "bun:test"
import {
  LINUX_UNIT_NAME,
  MAC_LABEL,
  WINDOWS_TASK_NAME,
  buildWindowsCreateArgs,
  buildWindowsDeleteArgs,
  disableLinux,
  disableMac,
  disableWindows,
  enableLinux,
  enableMac,
  enableWindows,
  hasSystemd,
  renderLinuxUnit,
  renderMacPlist,
  type RunResult,
  type Runner,
} from "./persistent-service"

const ok: RunResult = { exitCode: 0, stdout: "", stderr: "" }
const failing: RunResult = { exitCode: 1, stdout: "", stderr: "not found" }

function recordingRunner(result: RunResult = ok) {
  const calls: { cmd: string; args: string[] }[] = []
  const runner: Runner = async (cmd, args) => {
    calls.push({ cmd, args })
    return result
  }
  return { runner, calls }
}

const command = { exe: "C:\\Program Files\\opencode\\opencode.exe", args: ["serve", "--register"] }

describe("PersistentService windows", () => {
  test("create args reference the task name and quote paths with spaces", () => {
    const args = buildWindowsCreateArgs(command)
    expect(args).toContain(WINDOWS_TASK_NAME)
    expect(args).toContain("/sc")
    expect(args).toContain("onlogon")
    expect(args.join(" ")).toContain('"C:\\Program Files\\opencode\\opencode.exe" serve --register')
  })

  test("delete args reference the task name", () => {
    expect(buildWindowsDeleteArgs()).toEqual(["/delete", "/tn", WINDOWS_TASK_NAME, "/f"])
  })

  test("enableWindows/disableWindows call schtasks", async () => {
    const created = recordingRunner()
    await enableWindows(created.runner)
    expect(created.calls[0].cmd).toBe("schtasks")
    expect(created.calls[0].args).toContain("/create")

    const removed = recordingRunner()
    await disableWindows(removed.runner)
    expect(removed.calls[0].cmd).toBe("schtasks")
    expect(removed.calls[0].args).toContain("/delete")
  })
})

describe("PersistentService macOS", () => {
  test("renders a plist with RunAtLoad and KeepAlive", () => {
    const plist = renderMacPlist(command)
    expect(plist).toContain(`<string>${MAC_LABEL}</string>`)
    expect(plist).toContain("<key>RunAtLoad</key>")
    expect(plist).toContain("<key>KeepAlive</key>")
    expect(plist).toContain("<string>serve</string>")
  })

  test("enableMac/disableMac call launchctl", async () => {
    const loaded = recordingRunner()
    await enableMac(loaded.runner)
    expect(loaded.calls[0].cmd).toBe("launchctl")
    expect(loaded.calls[0].args[0]).toBe("load")

    const unloaded = recordingRunner()
    await disableMac(unloaded.runner)
    expect(unloaded.calls[0].cmd).toBe("launchctl")
    expect(unloaded.calls[0].args[0]).toBe("unload")
  })
})

describe("PersistentService Linux", () => {
  test("renders a systemd unit with Restart=always", () => {
    const unit = renderLinuxUnit(command)
    expect(unit).toContain("Restart=always")
    expect(unit).toContain("[Install]")
    expect(unit).toContain("WantedBy=default.target")
  })

  test("hasSystemd reflects systemctl --version exit code", async () => {
    expect(await hasSystemd(async () => ok)).toBe(true)
    expect(await hasSystemd(async () => failing)).toBe(false)
  })

  test("enableLinux refuses when systemd is unavailable, without touching the filesystem", async () => {
    const result = await enableLinux(async () => failing)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("systemd")
  })

  test("enableLinux/disableLinux call systemctl --user when systemd is available", async () => {
    const calls: { cmd: string; args: string[] }[] = []
    const runner: Runner = async (cmd, args) => {
      calls.push({ cmd, args })
      return ok
    }
    await enableLinux(runner)
    expect(calls.some((c) => c.args.includes("enable"))).toBe(true)
    expect(calls.every((c) => c.cmd === "systemctl")).toBe(true)

    calls.length = 0
    await disableLinux(runner)
    expect(calls[0].args).toEqual(["--user", "disable", "--now", LINUX_UNIT_NAME])
  })
})
