import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { desktopCapturer, screen } from "electron"

const execFileAsync = promisify(execFile)

/**
 * OS-level input dispatch. Electron has no built-in API to control input
 * outside its own windows, so each platform shells out to the automation
 * primitive that ships with the OS itself — no new native npm dependency,
 * which would need a prebuilt binary per Electron ABI/OS/arch and add real
 * risk to the cross-platform build pipeline (electron-builder already
 * targets win/mac/linux from this one repo). Screenshot capture is the one
 * exception: Electron's own `desktopCapturer` already covers all three
 * platforms without shelling out.
 */

export type ComputerActionResult = { ok: true } | { ok: false; error: string }

function scaleForPrimaryDisplay() {
  const display = screen.getPrimaryDisplay()
  return { width: display.size.width, height: display.size.height, scale: display.scaleFactor }
}

export async function captureScreenshot(): Promise<Buffer> {
  const { width, height, scale } = scaleForPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  })
  const primary = sources.find((s) => s.display_id) ?? sources[0]
  if (!primary) throw new Error("No screen source available for screenshot")
  return primary.thumbnail.toPNG()
}

async function runWindowsScript(script: string): Promise<void> {
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 15_000,
  })
}

// #region Windows — user32.dll via Add-Type, mirrors the manual P/Invoke
// approach already used ad hoc for this kind of automation.
const WIN32_SENDINPUT_HELPER = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Input {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
"@
`

async function winClick(x: number, y: number) {
  await runWindowsScript(`
    ${WIN32_SENDINPUT_HELPER}
    [Win32Input]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
    Start-Sleep -Milliseconds 30
    [Win32Input]::mouse_event(0x0002, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 30
    [Win32Input]::mouse_event(0x0004, 0, 0, 0, 0)
  `)
}

async function winMove(x: number, y: number) {
  await runWindowsScript(`
    ${WIN32_SENDINPUT_HELPER}
    [Win32Input]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
  `)
}

function escapePowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''")
}

async function winType(text: string) {
  await runWindowsScript(`
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(text)}')
  `)
}

const SENDKEYS_NAMED: Record<string, string> = {
  Enter: "{ENTER}",
  Tab: "{TAB}",
  Escape: "{ESC}",
  Backspace: "{BACKSPACE}",
  Delete: "{DELETE}",
  ArrowUp: "{UP}",
  ArrowDown: "{DOWN}",
  ArrowLeft: "{LEFT}",
  ArrowRight: "{RIGHT}",
  Home: "{HOME}",
  End: "{END}",
  PageUp: "{PGUP}",
  PageDown: "{PGDN}",
}

async function winKey(key: string) {
  const sequence = SENDKEYS_NAMED[key] ?? (key.length === 1 ? escapePowerShellSingleQuoted(key) : `{${key}}`)
  await runWindowsScript(`
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${sequence}')
  `)
}

async function winScroll(deltaX: number, deltaY: number) {
  // WHEEL_DELTA is 120 per notch; SendKeys has no scroll primitive, so this
  // goes through mouse_event's wheel flag directly instead.
  const notches = Math.round(-deltaY / 40) // gentler than a full notch per pixel-ish delta
  if (notches === 0) return
  await runWindowsScript(`
    ${WIN32_SENDINPUT_HELPER}
    [Win32Input]::mouse_event(0x0800, 0, 0, ${notches * 120}, 0)
  `)
}
// #endregion

// #region macOS — AppleScript via System Events, no extra binary required.
function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function macRunOsaScript(script: string) {
  await execFileAsync("osascript", ["-e", script], { timeout: 15_000 })
}

async function macClick(x: number, y: number) {
  await macRunOsaScript(`tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}`)
}

async function macMove(x: number, y: number) {
  // System Events has no bare cursor-move primitive; approximate with a
  // zero-duration drag start, which repositions the cursor without clicking.
  await macRunOsaScript(
    `tell application "System Events" to set mouseLoc to {${Math.round(x)}, ${Math.round(y)}}`,
  ).catch(() => undefined)
}

async function macType(text: string) {
  await macRunOsaScript(`tell application "System Events" to keystroke "${escapeAppleScriptString(text)}"`)
}

const APPLESCRIPT_KEY_CODES: Record<string, number> = {
  Enter: 36,
  Tab: 48,
  Escape: 53,
  Backspace: 51,
  Delete: 117,
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
}

async function macKey(key: string) {
  const code = APPLESCRIPT_KEY_CODES[key]
  if (code !== undefined) {
    await macRunOsaScript(`tell application "System Events" to key code ${code}`)
    return
  }
  await macRunOsaScript(`tell application "System Events" to keystroke "${escapeAppleScriptString(key)}"`)
}

async function macScroll(deltaX: number, deltaY: number) {
  // System Events has no direct scroll-wheel action; simulate with repeated
  // arrow-key presses in the dominant direction, which works inside most
  // scrollable views even without a wheel event.
  const key = Math.abs(deltaY) >= Math.abs(deltaX) ? (deltaY > 0 ? 125 : 126) : deltaX > 0 ? 124 : 123
  const presses = Math.min(20, Math.max(1, Math.round(Math.abs(deltaY || deltaX) / 40)))
  await macRunOsaScript(
    `tell application "System Events"\n${Array.from({ length: presses }, () => `  key code ${key}`).join("\n")}\nend tell`,
  )
}
// #endregion

// #region Linux — xdotool, the de-facto standard for X11 input automation.
// Not preinstalled everywhere (notably missing under Wayland-only setups);
// callers get a clear "not available" error instead of a silent no-op.
async function linuxRunXdotool(args: string[]) {
  try {
    await execFileAsync("xdotool", args, { timeout: 15_000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("ENOENT")) {
      throw new Error(
        "xdotool is not installed. Install it (e.g. `apt install xdotool`) to use computer control on Linux.",
      )
    }
    throw error
  }
}

async function linuxClick(x: number, y: number) {
  await linuxRunXdotool(["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1"])
}

async function linuxMove(x: number, y: number) {
  await linuxRunXdotool(["mousemove", String(Math.round(x)), String(Math.round(y))])
}

async function linuxType(text: string) {
  await linuxRunXdotool(["type", "--", text])
}

const XDOTOOL_KEY_NAMES: Record<string, string> = {
  Enter: "Return",
  Escape: "Escape",
  Backspace: "BackSpace",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
}

async function linuxKey(key: string) {
  await linuxRunXdotool(["key", XDOTOOL_KEY_NAMES[key] ?? key])
}

async function linuxScroll(deltaX: number, deltaY: number) {
  const button = deltaY > 0 ? "5" : "4" // xdotool click 4/5 = wheel up/down
  const clicks = Math.min(20, Math.max(1, Math.round(Math.abs(deltaY || deltaX) / 40)))
  for (let i = 0; i < clicks; i++) await linuxRunXdotool(["click", button])
}
// #endregion

type Backend = {
  click: (x: number, y: number) => Promise<void>
  move: (x: number, y: number) => Promise<void>
  type: (text: string) => Promise<void>
  key: (key: string) => Promise<void>
  scroll: (deltaX: number, deltaY: number) => Promise<void>
}

function backendFor(platform: NodeJS.Platform): Backend {
  if (platform === "win32") return { click: winClick, move: winMove, type: winType, key: winKey, scroll: winScroll }
  if (platform === "darwin") return { click: macClick, move: macMove, type: macType, key: macKey, scroll: macScroll }
  return { click: linuxClick, move: linuxMove, type: linuxType, key: linuxKey, scroll: linuxScroll }
}

const backend = backendFor(process.platform)

export async function computerClick(x: number, y: number) {
  await backend.click(x, y)
}

export async function computerMove(x: number, y: number) {
  await backend.move(x, y)
}

export async function computerType(text: string) {
  await backend.type(text)
}

export async function computerKey(key: string) {
  await backend.key(key)
}

export async function computerScroll(deltaX: number, deltaY: number) {
  await backend.scroll(deltaX, deltaY)
}
