import { createEffect, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import type { BatutaActivity, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { getToolInfo, type ToolInfo } from "@opencode-ai/session-ui/message-part"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { SettingsListV2 } from "@/components/settings-v2/parts/list"
import { SettingsRowV2 } from "@/components/settings-v2/parts/row"

const POLL_INTERVAL_MS = 2000

type ActiveTool = { tool: string; input: Record<string, unknown>; metadata?: Record<string, unknown> }

type PanelNode = {
  sessionID: string
  label: string
  isOrchestrator: boolean
  status: SessionStatus
  tool?: ToolInfo
}

const statusKey = (status: SessionStatus["type"]) => `batuta.panel.status.${status}` as const

async function latestActiveTool(
  client: ReturnType<ReturnType<typeof useServerSDK>>["client"],
  sessionID: string,
): Promise<ActiveTool | undefined> {
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

export const BatutaActivityPanel2D: Component<{
  orchestratorSessionID: string
  activity: BatutaActivity
}> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [nodes, setNodes] = createSignal<PanelNode[]>([])

  const workerLabel = (session: Session) =>
    props.activity.workers.find((worker) => session.title?.includes(worker.label))?.label ?? session.title ?? session.id

  const poll = async () => {
    const client = serverSDK().client
    const [statusResult, childrenResult] = await Promise.all([
      client.session.status(),
      client.session.children({ sessionID: props.orchestratorSessionID }),
    ])
    const statusByID = statusResult.data ?? {}
    const children = childrenResult.data ?? []

    const sessions: Array<{ id: string; label: string; isOrchestrator: boolean }> = [
      { id: props.orchestratorSessionID, label: props.activity.name, isOrchestrator: true },
      ...children.map((child) => ({ id: child.id, label: workerLabel(child), isOrchestrator: false })),
    ]

    const next = await Promise.all(
      sessions.map(async (session): Promise<PanelNode> => {
        const status: SessionStatus = statusByID[session.id] ?? { type: "idle" }
        const active = status.type === "busy" ? await latestActiveTool(client, session.id).catch(() => undefined) : undefined
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
  }

  createEffect(() => {
    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <SettingsListV2>
      <For each={nodes()}>
        {(node) => (
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name={node.isOrchestrator ? "task" : "subagent"} class="size-3.5 shrink-0 text-text-weak" />
                {node.label}
              </span>
            }
            description={
              <Show
                when={node.tool}
                fallback={<span class="text-text-weak">{language.t(statusKey(node.status.type))}</span>}
              >
                {(tool) => (
                  <span class="flex items-center gap-1.5 text-text-weak">
                    <Icon name={tool().icon} class="size-3.5 shrink-0" />
                    {tool().title}
                    <Show when={tool().subtitle}>
                      <span class="truncate opacity-70">{tool().subtitle}</span>
                    </Show>
                  </span>
                )}
              </Show>
            }
          >
            <Tag>{language.t(statusKey(node.status.type))}</Tag>
          </SettingsRowV2>
        )}
      </For>
    </SettingsListV2>
  )
}
