import { createEffect, createMemo, For, onCleanup, onMount, Show, type Component } from "solid-js"
import * as THREE from "three"
import { Icon } from "@opencode-ai/ui/icon"
import type { BatutaActivity, SessionStatus } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { createBatutaActivityNodes } from "./use-activity-nodes"

const RADIUS_PERCENT = 34
const RADIUS_WORLD = 0.62
const PULSE_SPEED = 0.55

function layout(index: number, total: number) {
  const angle = total <= 0 ? 0 : (index / total) * Math.PI * 2 - Math.PI / 2
  return { angle, cos: Math.cos(angle), sin: Math.sin(angle) }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function readColor(varName: string, fallback: string) {
  if (typeof document === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return value || fallback
}

const statusKey = (status: SessionStatus["type"]) => `batuta.panel.status.${status}` as const

type WorkerVisual = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  pulse: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  x: number
  y: number
  pulseT: number
  busy: boolean
}

export const BatutaActivityPanel3D: Component<{
  orchestratorSessionID: string
  activity: BatutaActivity
}> = (props) => {
  const language = useLanguage()
  const nodes = createBatutaActivityNodes(props)
  let container: HTMLDivElement | undefined

  const workers = createMemo(() => nodes().filter((node) => !node.isOrchestrator))
  const orchestrator = createMemo(() => nodes().find((node) => node.isOrchestrator))
  const positions = createMemo(() => workers().map((node, index) => ({ node, ...layout(index, workers().length) })))

  onMount(() => {
    if (!container) return
    const reduced = prefersReducedMotion()

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 2

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.position = "absolute"
    renderer.domElement.style.inset = "0"
    container.appendChild(renderer.domElement)

    const colorIdle = new THREE.Color(readColor("--v2-icon-icon-muted", "#6b7280"))
    const colorBusy = new THREE.Color(readColor("--v2-state-fg-info", "#3b82f6"))
    const colorRetry = new THREE.Color(readColor("--v2-state-fg-warning", "#f59e0b"))
    const colorLine = new THREE.Color(readColor("--v2-border-border-base", "#33363b"))

    const statusColor = (status: SessionStatus["type"]) =>
      status === "busy" ? colorBusy : status === "retry" ? colorRetry : colorIdle

    const linesGroup = new THREE.Group()
    const nodesGroup = new THREE.Group()
    scene.add(linesGroup, nodesGroup)

    const orchestratorGeometry = new THREE.SphereGeometry(0.09, 24, 24)
    const workerGeometry = new THREE.SphereGeometry(0.055, 20, 20)
    const pulseGeometry = new THREE.SphereGeometry(0.028, 12, 12)

    const orchestratorMesh = new THREE.Mesh(orchestratorGeometry, new THREE.MeshBasicMaterial({ color: colorIdle }))
    nodesGroup.add(orchestratorMesh)

    const workerVisuals: WorkerVisual[] = []

    const render = () => renderer.render(scene, camera)

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const dt = clock.getDelta()
      for (const visual of workerVisuals) {
        if (visual.busy) {
          visual.pulseT = (visual.pulseT + dt * PULSE_SPEED) % 1
          visual.pulse.position.set(visual.x * visual.pulseT, visual.y * visual.pulseT, 0)
          visual.pulse.visible = true
        } else {
          visual.pulse.visible = false
        }
      }
      render()
      raf = requestAnimationFrame(tick)
    }

    const resize = () => {
      if (!container) return
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const syncVisuals = () => {
      const list = positions()

      while (workerVisuals.length > list.length) {
        const visual = workerVisuals.pop()!
        nodesGroup.remove(visual.mesh, visual.pulse)
        linesGroup.remove(visual.line)
      }
      while (workerVisuals.length < list.length) {
        const mesh = new THREE.Mesh(workerGeometry, new THREE.MeshBasicMaterial({ color: colorIdle }))
        const pulse = new THREE.Mesh(pulseGeometry, new THREE.MeshBasicMaterial({ color: colorBusy }))
        pulse.visible = false
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: colorLine, transparent: true, opacity: 0.5 }),
        )
        nodesGroup.add(mesh, pulse)
        linesGroup.add(line)
        workerVisuals.push({ mesh, line, pulse, x: 0, y: 0, pulseT: Math.random(), busy: false })
      }

      list.forEach(({ node, cos, sin }, index) => {
        const visual = workerVisuals[index]
        const x = cos * RADIUS_WORLD
        const y = -sin * RADIUS_WORLD
        visual.x = x
        visual.y = y
        visual.busy = node.status.type === "busy"
        visual.mesh.position.set(x, y, 0)
        visual.line.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, 0)])
        visual.mesh.material.color = statusColor(node.status.type)
      })

      const orch = orchestrator()
      if (orch) orchestratorMesh.material.color = statusColor(orch.status.type)

      render()
    }

    createEffect(syncVisuals)

    if (reduced) render()
    else tick()

    onCleanup(() => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.dispose()
      orchestratorGeometry.dispose()
      workerGeometry.dispose()
      pulseGeometry.dispose()
      container?.removeChild(renderer.domElement)
    })
  })

  return (
    <div class="relative mx-auto aspect-square w-full max-w-[420px]" ref={container}>
      <div class="pointer-events-none absolute inset-0">
        <Show when={orchestrator()}>
          {(orch) => (
            <div class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center">
              <Icon name="task" class="size-4 text-v2-icon-icon-base" />
              <span class="text-12-medium whitespace-nowrap text-v2-text-text-base">{orch().label}</span>
              <span class="text-11-regular text-v2-text-text-muted">{language.t(statusKey(orch().status.type))}</span>
            </div>
          )}
        </Show>
        <For each={positions()}>
          {({ node, cos, sin }) => (
            <div
              class="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
              style={{ left: `${50 + cos * RADIUS_PERCENT}%`, top: `${50 + sin * RADIUS_PERCENT}%` }}
            >
              <Icon name={node.tool?.icon ?? "subagent"} class="size-4 text-v2-icon-icon-base" />
              <span class="text-12-medium whitespace-nowrap text-v2-text-text-base">{node.label}</span>
              <span class="text-11-regular whitespace-nowrap text-v2-text-text-muted">
                {node.tool?.title ?? language.t(statusKey(node.status.type))}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
