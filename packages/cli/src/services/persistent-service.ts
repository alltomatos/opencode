export * as PersistentService from "./persistent-service"

import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface RunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type Runner = (cmd: string, args: string[]) => Promise<RunResult>

export const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException).code === "number" ? (error as any).code : error ? 1 : 0
      resolve({ exitCode: code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" })
    })
  })

export interface Command {
  readonly exe: string
  readonly args: readonly string[]
}

/** Same compiled-vs-bun entrypoint resolution as Daemon.Service.start(). */
export function resolveCommand(): Command {
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  const entrypoint = compiled ? undefined : process.argv[1]
  return { exe: process.execPath, args: [...(entrypoint ? [entrypoint] : []), "serve", "--register"] }
}

// -- Windows: Task Scheduler, "at logon" of the current user, no elevation --

export const WINDOWS_TASK_NAME = "OpencodeService"

export function buildWindowsCreateArgs(command: Command): string[] {
  const commandLine = [command.exe, ...command.args].map(quoteWindows).join(" ")
  return ["/create", "/tn", WINDOWS_TASK_NAME, "/tr", commandLine, "/sc", "onlogon", "/rl", "limited", "/f"]
}

export function buildWindowsDeleteArgs(): string[] {
  return ["/delete", "/tn", WINDOWS_TASK_NAME, "/f"]
}

function quoteWindows(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

export const enableWindows = (runner: Runner = defaultRunner) => runner("schtasks", buildWindowsCreateArgs(resolveCommand()))
export const disableWindows = (runner: Runner = defaultRunner) => runner("schtasks", buildWindowsDeleteArgs())

// -- macOS: LaunchAgent, RunAtLoad + KeepAlive --

export const MAC_LABEL = "dev.opencode.service"

export function macPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`)
}

export function renderMacPlist(command: Command): string {
  const args = [command.exe, ...command.args].map((value) => `    <string>${escapeXml(value)}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export async function enableMac(runner: Runner = defaultRunner): Promise<RunResult> {
  const plistPath = macPlistPath()
  fs.mkdirSync(path.dirname(plistPath), { recursive: true })
  fs.writeFileSync(plistPath, renderMacPlist(resolveCommand()))
  return runner("launchctl", ["load", plistPath])
}

export async function disableMac(runner: Runner = defaultRunner): Promise<RunResult> {
  const plistPath = macPlistPath()
  const result = await runner("launchctl", ["unload", plistPath])
  fs.rmSync(plistPath, { force: true })
  return result
}

// -- Linux: systemd --user service, Restart=always --

export const LINUX_UNIT_NAME = "opencode.service"

export function linuxUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", LINUX_UNIT_NAME)
}

export function renderLinuxUnit(command: Command): string {
  const execStart = [command.exe, ...command.args].map(quoteUnix).join(" ")
  return `[Unit]
Description=opencode background server

[Service]
ExecStart=${execStart}
Restart=always

[Install]
WantedBy=default.target
`
}

function quoteUnix(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

export async function hasSystemd(runner: Runner = defaultRunner): Promise<boolean> {
  const result = await runner("systemctl", ["--user", "--version"])
  return result.exitCode === 0
}

export async function enableLinux(runner: Runner = defaultRunner): Promise<RunResult> {
  if (!(await hasSystemd(runner))) {
    return { exitCode: 1, stdout: "", stderr: "systemd --user is not available on this system" }
  }
  const unitPath = linuxUnitPath()
  fs.mkdirSync(path.dirname(unitPath), { recursive: true })
  fs.writeFileSync(unitPath, renderLinuxUnit(resolveCommand()))
  await runner("systemctl", ["--user", "daemon-reload"])
  return runner("systemctl", ["--user", "enable", "--now", LINUX_UNIT_NAME])
}

export async function disableLinux(runner: Runner = defaultRunner): Promise<RunResult> {
  const result = await runner("systemctl", ["--user", "disable", "--now", LINUX_UNIT_NAME])
  fs.rmSync(linuxUnitPath(), { force: true })
  return result
}

// -- Platform dispatch --

export function enable(runner: Runner = defaultRunner): Promise<RunResult> {
  if (process.platform === "win32") return enableWindows(runner)
  if (process.platform === "darwin") return enableMac(runner)
  if (process.platform === "linux") return enableLinux(runner)
  return Promise.resolve({ exitCode: 1, stdout: "", stderr: `Unsupported platform: ${process.platform}` })
}

export function disable(runner: Runner = defaultRunner): Promise<RunResult> {
  if (process.platform === "win32") return disableWindows(runner)
  if (process.platform === "darwin") return disableMac(runner)
  if (process.platform === "linux") return disableLinux(runner)
  return Promise.resolve({ exitCode: 1, stdout: "", stderr: `Unsupported platform: ${process.platform}` })
}
