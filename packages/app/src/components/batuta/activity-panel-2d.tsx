import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { BatutaActivity, SessionStatus } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { createBatutaActivityNodes, type BatutaPanelNode } from "./use-activity-nodes"
import { OrchestratorIcon, WorkerIcon } from "./role-icons"
import "./activity-panel-2d.css"

const statusKey = (status: SessionStatus["type"]) => `batuta.panel.status.${status}` as const

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function StatusDot(props: { status: SessionStatus["type"] }) {
  const color = () =>
    props.status === "busy"
      ? "var(--v2-state-fg-info)"
      : props.status === "retry"
        ? "var(--v2-state-fg-warning)"
        : "var(--v2-icon-icon-muted)"
  return (
    <span
      data-component="batuta-flow-status-dot"
      data-status={props.status}
      class="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: color(), color: color() }}
    />
  )
}

function NodeCard(props: {
  node: BatutaPanelNode
  root?: boolean
  onClick?: () => void
  ref?: (el: HTMLDivElement) => void
}) {
  const language = useLanguage()
  return (
    <div
      ref={props.ref}
      data-component="batuta-flow-node"
      data-status={props.node.status.type}
      classList={{ "cursor-pointer": !!props.onClick }}
      onClick={props.onClick}
      class={`
        flex w-[196px] flex-col gap-1.5 rounded-[10px] border border-v2-border-border-base
        bg-v2-background-bg-elevated px-3 py-2.5 shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="flex items-center gap-1.5">
        <Show
          when={props.node.isOrchestrator}
          fallback={<WorkerIcon class="size-5 shrink-0" animated={props.node.status.type === "busy"} />}
        >
          <OrchestratorIcon class="size-5 shrink-0" animated={props.node.status.type === "busy"} />
        </Show>
        <span class="flex-1 truncate text-12-medium text-v2-text-text-base">{props.node.label}</span>
        <StatusDot status={props.node.status.type} />
      </div>
      <Show
        when={props.node.tool}
        fallback={
          <span class="truncate text-11-regular text-v2-text-text-muted">
            {language.t(statusKey(props.node.status.type))}
          </span>
        }
      >
        {(tool) => (
          <span class="flex items-center gap-1 truncate text-11-regular text-v2-text-text-muted">
            <Icon name={tool().icon} class="size-3 shrink-0" />
            <span class="truncate">{tool().title}</span>
          </span>
        )}
      </Show>
    </div>
  )
}

export const BatutaActivityPanel2D: Component<{
  orchestratorSessionID: string
  activity: BatutaActivity
  onSelectNode?: (node: BatutaPanelNode) => void
}> = (props) => {
  const nodes = createBatutaActivityNodes(props)
  const orchestrator = createMemo(() => nodes().find((node) => node.isOrchestrator))
  const workers = createMemo(() => nodes().filter((node) => !node.isOrchestrator))

  let container: HTMLDivElement | undefined
  let rootRef: HTMLDivElement | undefined
  const workerRefs = new Map<string, HTMLDivElement>()
  const [paths, setPaths] = createSignal<Array<{ id: string; d: string; active: boolean }>>([])

  const recompute = () => {
    if (!container || !rootRef) return
    const containerRect = container.getBoundingClientRect()
    const rootRect = rootRef.getBoundingClientRect()
    const originX = rootRect.left + rootRect.width / 2 - containerRect.left
    const originY = rootRect.bottom - containerRect.top

    const next = workers().map((node) => {
      const el = workerRefs.get(node.sessionID)
      const rect = el?.getBoundingClientRect()
      const targetX = rect ? rect.left + rect.width / 2 - containerRect.left : originX
      const targetY = rect ? rect.top - containerRect.top : originY
      const midY = originY + (targetY - originY) / 2
      return {
        id: node.sessionID,
        d: `M ${originX} ${originY} C ${originX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`,
        active: node.status.type === "busy",
      }
    })
    setPaths(next)
  }

  onMount(() => {
    if (!container) return
    const observer = new ResizeObserver(() => recompute())
    observer.observe(container)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    // Re-run whenever node count/labels/status change (layout can shift on wrap).
    workers().length
    workers().map((node) => node.status.type).join(",")
    queueMicrotask(recompute)
  })

  const reduced = prefersReducedMotion()

  return (
    <div data-component="batuta-flow" class="relative flex w-full flex-col items-center gap-6" ref={container}>
      <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <For each={paths()}>
          {(path) => (
            <path
              d={path.d}
              fill="none"
              stroke="var(--v2-border-border-base)"
              stroke-width="2"
              stroke-dasharray="4 5"
              opacity={path.active ? 0.35 : 1}
            />
          )}
        </For>
        <Show when={!reduced}>
          <For each={paths().filter((path) => path.active)}>
            {(path) => (
              <circle r="4" fill="var(--v2-state-fg-info)" style={{ filter: "drop-shadow(0 0 4px var(--v2-state-fg-info))" }}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={path.d} />
              </circle>
            )}
          </For>
        </Show>
      </svg>

      <Show when={orchestrator()}>
        {(node) => (
          <NodeCard node={node()} root ref={(el) => (rootRef = el)} onClick={() => props.onSelectNode?.(node())} />
        )}
      </Show>

      <div class="flex flex-wrap justify-center gap-x-6 gap-y-8">
        <For each={workers()}>
          {(node) => (
            <NodeCard
              node={node}
              ref={(el) => workerRefs.set(node.sessionID, el)}
              onClick={() => props.onSelectNode?.(node)}
            />
          )}
        </For>
      </div>
    </div>
  )
}
