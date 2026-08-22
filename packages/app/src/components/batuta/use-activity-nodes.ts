import { createEffect, createSignal, onCleanup } from "solid-js"
import type { BatutaActivity, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { getToolInfo, type ToolInfo } from "@opencode-ai/session-ui/message-part"
import { useServerSDK } from "@/context/server-sdk"

const POLL_INTERVAL_MS = 2000
const MAX_CONSECUTIVE_FAILURES = 3

export type BatutaPanelNode = {
  sessionID: string
  label: string
  isOrchestrator: boolean
  status: SessionStatus
  tool?: ToolInfo
}

async function latestActiveTool(
  client: ReturnType<ReturnType<typeof useServerSDK>>["client"],
  sessionID: string,
): Promise<{ tool: string; input: Record<string, unknown>; metadata?: Record<string, unknown> } | undefined> {
  const result = await client.session.messages({ sessionID, limit: 3 })
  const messages = result.data ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part?.type !== "tool") continue
      if (part.state.status !== "running") continue
      return { tool: part.tool, input: part.state.input, metadata: part.state.metadata }
    }
  }
  return undefined
}

export function createBatutaActivityNodes(props: { orchestratorSessionID: string; activity: BatutaActivity }) {
  const serverSDK = useServerSDK()
  const [nodes, setNodes] = createSignal<BatutaPanelNode[]>([])

  // Child session titles are the task's free-text description, not the worker label, so an exact
  // match is rare — try a substring match first, then fall back to creation order vs. worker order
  // (children are returned oldest-first, matching the order the orchestrator typically delegates in).
  const workerLabel = (session: Session, index: number) =>
    props.activity.workers.find((worker) => session.title?.includes(worker.label))?.label ??
    props.activity.workers[index]?.label ??
    session.title ??
    session.id

  let consecutiveFailures = 0

  const poll = async (): Promise<{ stop?: boolean }> => {
    const client = serverSDK().client
    // The orchestrator session can disappear from under us (activity removed,
    // server restarted, etc.) — swallow polling failures instead of leaving
    // an unhandled rejection spamming the console every 2s, and stop retrying
    // altogether after a few in a row rather than hammering the server forever.
    try {
      const [statusResult, childrenResult] = await Promise.all([
        client.session.status(),
        client.session.children({ sessionID: props.orchestratorSessionID }),
      ])
      const statusByID = statusResult.data ?? {}
      const children = childrenResult.data ?? []

      const sessions: Array<{ id: string; label: string; isOrchestrator: boolean }> = [
        { id: props.orchestratorSessionID, label: props.activity.name, isOrchestrator: true },
        ...children.map((child, index) => ({ id: child.id, label: workerLabel(child, index), isOrchestrator: false })),
      ]

      const next = await Promise.all(
        sessions.map(async (session): Promise<BatutaPanelNode> => {
          const status: SessionStatus = statusByID[session.id] ?? { type: "idle" }
          const active =
            status.type === "busy" ? await latestActiveTool(client, session.id).catch(() => undefined) : undefined
          return {
            sessionID: session.id,
            label: session.label,
            isOrchestrator: session.isOrchestrator,
            status,
            tool: active ? getToolInfo(active.tool, active.input, active.metadata) : undefined,
          }
        }),
      )

      setNodes(next)
      consecutiveFailures = 0
    } catch {
      // Keep showing the last known nodes rather than clearing the panel on
      // a single transient failure.
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return { stop: true }
    }
    return {}
  }

  createEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      void poll().then((result) => {
        if (result.stop) clearInterval(timer)
      })
    }
    tick()
    timer = setInterval(tick, POLL_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return nodes
}
