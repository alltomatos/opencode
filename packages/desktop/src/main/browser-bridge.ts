import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import type { BrowserPanel } from "./browser-panel"
import { write as writeLog } from "./logging"

type AXNode = {
  nodeId: string
  role?: { value?: string }
  name?: { value?: string }
  backendDOMNodeId?: number
  childIds?: string[]
  ignored?: boolean
}

const snapshotRefs = new Map<string, Map<string, number>>()

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": data.length })
  res.end(data)
}

function flattenAXTree(nodes: AXNode[]): { outline: string; refs: Map<string, number> } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const roots = nodes.filter((n) => !nodes.some((other) => other.childIds?.includes(n.nodeId)))
  const lines: string[] = []
  const refs = new Map<string, number>()
  let counter = 0

  function visit(node: AXNode, depth: number) {
    if (node.ignored) {
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId)
        if (child) visit(child, depth)
      }
      return
    }
    const role = node.role?.value ?? "generic"
    const name = node.name?.value?.trim()
    if (role !== "generic" || name) {
      const ref = `ref_${++counter}`
      if (node.backendDOMNodeId !== undefined) refs.set(ref, node.backendDOMNodeId)
      const label = name ? `${role} "${name}"` : role
      lines.push(`${"  ".repeat(depth)}[${ref}] ${label}`)
    }
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child) visit(child, node.ignored ? depth : depth + 1)
    }
  }

  for (const root of roots) visit(root, 0)
  return { outline: lines.join("\n") || "(empty page)", refs }
}

export type BrowserBridge = {
  port: number
  token: string
  stop(): void
}

export function startBrowserBridge(getPanel: (id: string) => BrowserPanel | undefined): Promise<BrowserBridge> {
  const token = randomBytes(32).toString("hex")

  const server = createServer(async (req, res) => {
    try {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const match = url.pathname.match(/^\/panels\/([^/]+)\/(.+)$/)
      if (!match) {
        sendJson(res, 404, { error: "not found" })
        return
      }
      const [, panelId, action] = match
      const panel = getPanel(panelId)
      if (!panel) {
        sendJson(res, 404, { error: "panel not found" })
        return
      }

      if (action === "navigate" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.url !== "string") throw new Error("url is required")
        await panel.navigate(body.url)
        sendJson(res, 200, panel.state())
        return
      }
      if (action === "back" && req.method === "POST") {
        panel.goBack()
        sendJson(res, 200, panel.state())
        return
      }
      if (action === "forward" && req.method === "POST") {
        panel.goForward()
        sendJson(res, 200, panel.state())
        return
      }
      if (action === "reload" && req.method === "POST") {
        panel.reload()
        sendJson(res, 200, panel.state())
        return
      }
      if (action === "state" && req.method === "GET") {
        sendJson(res, 200, panel.state())
        return
      }
      if (action === "click" && req.method === "POST") {
        const body = await readJson(req)
        let x: number | undefined = body.x
        let y: number | undefined = body.y
        if (body.ref) {
          const refs = snapshotRefs.get(panelId)
          const backendNodeId = refs?.get(body.ref)
          if (backendNodeId === undefined) throw new Error(`unknown ref ${body.ref}, take a new snapshot`)
          const box = await panel.sendCommand<{ model: { content: number[] } }>("DOM.getBoxModel", { backendNodeId })
          const quad = box.model.content
          x = (quad[0] + quad[4]) / 2
          y = (quad[1] + quad[5]) / 2
        }
        if (x === undefined || y === undefined) throw new Error("x/y or ref is required")
        await panel.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
        await panel.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === "type" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.text !== "string") throw new Error("text is required")
        await panel.sendCommand("Input.insertText", { text: body.text })
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === "key" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.key !== "string") throw new Error("key is required")
        await panel.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: body.key })
        await panel.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: body.key })
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === "scroll" && req.method === "POST") {
        const body = await readJson(req)
        const dx = Number(body.deltaX ?? 0)
        const dy = Number(body.deltaY ?? 0)
        await panel.sendCommand("Runtime.evaluate", { expression: `window.scrollBy(${dx}, ${dy})` })
        sendJson(res, 200, { ok: true })
        return
      }
      if (action === "screenshot" && req.method === "GET") {
        const image = await panel.view.webContents.capturePage()
        const png = image.toPNG()
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length })
        res.end(png)
        return
      }
      if (action === "snapshot" && req.method === "GET") {
        const tree = await panel.sendCommand<{ nodes: AXNode[] }>("Accessibility.getFullAXTree")
        const { outline, refs } = flattenAXTree(tree.nodes)
        snapshotRefs.set(panelId, refs)
        sendJson(res, 200, { outline })
        return
      }

      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      writeLog("browser-bridge", `request failed: ${String(error)}`, undefined, "error")
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("failed to determine browser bridge port"))
        return
      }
      resolve({
        port: address.port,
        token,
        stop: () => server.close(),
      })
    })
  })
}
