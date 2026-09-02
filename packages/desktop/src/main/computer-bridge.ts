import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { write as writeLog } from "./logging"
import {
  captureScreenshot,
  computerClick,
  computerKey,
  computerMove,
  computerScroll,
  computerType,
} from "./computer-control"

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

export type ComputerBridge = {
  port: number
  token: string
  stop(): void
}

/**
 * Same shape as browser-bridge.ts's HTTP bridge, but dispatching to OS-level
 * input (computer-control.ts) instead of a CDP-attached BrowserView — this
 * is the piece that lets the agent drive the whole desktop, not just the
 * embedded browser panel.
 */
export function startComputerBridge(): Promise<ComputerBridge> {
  const token = randomBytes(32).toString("hex")

  const server = createServer(async (req, res) => {
    try {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${token}`) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1")

      if (url.pathname === "/screenshot" && req.method === "GET") {
        const png = await captureScreenshot()
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length })
        res.end(png)
        return
      }
      if (url.pathname === "/click" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.x !== "number" || typeof body.y !== "number") throw new Error("x and y are required")
        await computerClick(body.x, body.y)
        sendJson(res, 200, { ok: true })
        return
      }
      if (url.pathname === "/move" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.x !== "number" || typeof body.y !== "number") throw new Error("x and y are required")
        await computerMove(body.x, body.y)
        sendJson(res, 200, { ok: true })
        return
      }
      if (url.pathname === "/type" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.text !== "string") throw new Error("text is required")
        await computerType(body.text)
        sendJson(res, 200, { ok: true })
        return
      }
      if (url.pathname === "/key" && req.method === "POST") {
        const body = await readJson(req)
        if (typeof body.key !== "string") throw new Error("key is required")
        await computerKey(body.key)
        sendJson(res, 200, { ok: true })
        return
      }
      if (url.pathname === "/scroll" && req.method === "POST") {
        const body = await readJson(req)
        await computerScroll(Number(body.deltaX ?? 0), Number(body.deltaY ?? 0))
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      writeLog("computer-bridge", `request failed: ${String(error)}`, undefined, "error")
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("failed to determine computer bridge port"))
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
