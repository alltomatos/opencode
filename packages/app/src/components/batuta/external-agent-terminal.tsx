import type { FitAddon, Ghostty, Terminal as Term } from "ghostty-web"
import { createEffect, onCleanup, onMount } from "solid-js"
import { withAlpha } from "@opencode-ai/ui/theme/color"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { useServerSDK } from "@/context/server-sdk"
import { terminalFontFamily, useSettings } from "@/context/settings"

// Read-only viewer for an ExternalAgent PTY session (#106's WS surface). Deliberately NOT
// built on top of components/terminal.tsx — that component is tightly coupled to
// Pty.Service's resize-negotiation, v1/v2 protocol branching, and reconnect-with-ticket-
// refresh machinery. This only needs to render a live output stream: connect, write
// incoming chunks, reconnect on drop. Manual input (#108) will extend this, not
// components/terminal.tsx, once it lands.
export interface ExternalAgentTerminalProps {
  handle: string
  directory: string
  class?: string
}

type TerminalColors = { background: string; foreground: string; cursor: string; selectionBackground: string }
const DEFAULT_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: { background: "#fcfcfc", foreground: "#211e1e", cursor: "#211e1e", selectionBackground: withAlpha("#211e1e", 0.2) },
  dark: { background: "#191515", foreground: "#d4d4d4", cursor: "#d4d4d4", selectionBackground: withAlpha("#d4d4d4", 0.25) },
}

let shared: Promise<{ mod: typeof import("ghostty-web"); ghostty: Ghostty }> | undefined
const loadGhostty = () => {
  if (shared) return shared
  shared = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((err) => {
      shared = undefined
      throw err
    })
  return shared
}

export function ExternalAgentTerminal(props: ExternalAgentTerminalProps) {
  const theme = useTheme()
  const settings = useSettings()
  const serverSDK = useServerSDK()
  let container: HTMLDivElement | undefined
  let term: Term | undefined
  let fit: FitAddon | undefined
  let socket: WebSocket | undefined
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let tries = 0

  const colors = () => DEFAULT_COLORS[theme.mode() === "dark" ? "dark" : "light"]

  onMount(() => {
    let cleanupUi: VoidFunction[] = []

    const run = async () => {
      const { mod, ghostty } = await loadGhostty()
      if (disposed || !container) return

      const t = new mod.Terminal({
        cursorBlink: false,
        fontSize: 13,
        fontFamily: terminalFontFamily(settings.appearance.terminalFont()),
        convertEol: false,
        disableStdin: true,
        theme: colors(),
        scrollback: 10_000,
        ghostty,
      })
      term = t
      cleanupUi.push(() => t.dispose())

      const fitAddon = new mod.FitAddon()
      fit = fitAddon
      t.loadAddon(fitAddon)
      t.open(container)
      fitAddon.fit()
      fitAddon.observeResize()

      const onResize = () => fitAddon.fit()
      window.addEventListener("resize", onResize)
      cleanupUi.push(() => window.removeEventListener("resize", onResize))

      connect()
    }

    const connect = async () => {
      if (disposed) return
      const token = await serverSDK()
        .client.externalAgent.connectToken({ handle: props.handle, directory: props.directory }, {
          headers: { "x-opencode-ticket": "1" },
        })
        .then((result) => (result.response.status === 200 ? result.data?.ticket : undefined))
        .catch(() => undefined)
      if (disposed) return
      // Session gone (404) or forbidden — nothing left to connect to, don't retry.
      if (!token) return

      const url = new URL(`${serverSDK().url}/external-agent/sessions/${props.handle}/connect`)
      url.searchParams.set("directory", props.directory)
      url.searchParams.set("ticket", token)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

      const ws = new WebSocket(url)
      socket = ws

      ws.addEventListener("open", () => {
        tries = 0
      })
      ws.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return
        term?.write(event.data)
      })
      ws.addEventListener("close", (event) => {
        if (socket === ws) socket = undefined
        if (disposed) return
        // 4404 = session not found (see handlers/external-agent.ts) — the worker
        // finished or was killed; stop trying, the panel's caller is responsible
        // for hiding this component once the worker is no longer active.
        if (event.code === 4404) return
        const delay = Math.min(250 * 2 ** Math.min(tries, 4), 4_000)
        tries += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    void run()

    onCleanup(() => {
      disposed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      socket?.close(1000)
      for (const fn of cleanupUi.splice(0).reverse()) fn()
    })
  })

  createEffect(() => {
    term?.setOption?.("theme", colors())
  })

  return <div ref={container} class={props.class} classList={{ "size-full overflow-hidden": true }} />
}
