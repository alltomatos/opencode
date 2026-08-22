import { createEffect, createMemo, For, onCleanup, onMount, Show, type Component } from "solid-js"
import * as THREE from "three"
import type { BatutaActivity, SessionStatus } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { createBatutaActivityNodes, type BatutaPanelNode } from "./use-activity-nodes"
import { buildCharacter, type Character } from "./characters-3d"

const RADIUS_PERCENT = 34
const RADIUS_WORLD = 0.72
const PULSE_SPEED = 0.55
// Big enough that the capsule body / sphere head / headwear actually read as
// volume — at small scale a low-poly figure just looks like a flat blob.
const CHARACTER_SCALE = 0.62
const CHARACTER_FIGURE_HEIGHT = 0.55
// Characters are vertically centered on their group origin (see characters-3d.ts) —
// the ring sits at their feet, half the scaled figure height below that origin.
const CHARACTER_FEET_Y = -(CHARACTER_FIGURE_HEIGHT / 2) * CHARACTER_SCALE + 0.005
// A fixed 3/4 turn, not straight-on — a symmetric capsule+sphere viewed
// dead-on reads as flat no matter the lighting; seeing it from an angle is
// what actually sells "3D" here.
const BASE_ROTATION_Y = 0.55
const ARM_REST_ROTATION = -0.3
const ARM_SWING_AMPLITUDE = 1.3
// Idle sway/bob keeps every character subtly alive even when nothing is
// delegated yet; busy characters bounce/sway MUCH more so "working" is
// unmistakable at a glance, not just a subtle difference from idle.
const IDLE_SWAY_AMPLITUDE = 0.08
const IDLE_BOB_AMPLITUDE = 0.012
const BUSY_BOB_AMPLITUDE = 0.11

function layout(index: number, total: number) {
  const angle = total <= 0 ? 0 : (index / total) * Math.PI * 2 - Math.PI / 2
  return { angle, cos: Math.cos(angle), sin: Math.sin(angle) }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

const statusKey = (status: SessionStatus["type"]) => `batuta.panel.status.${status}` as const

type WorkerVisual = {
  character: Character
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  pulse: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  x: number
  y: number
  pulseT: number
  busy: boolean
  /** Random per-worker phase offset so idle sway/bob doesn't move every worker in lockstep. */
  phase: number
}

export const BatutaActivityPanel3D: Component<{
  orchestratorSessionID: string
  activity: BatutaActivity
  onSelectNode?: (node: BatutaPanelNode) => void
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

    // MeshStandardMaterial (used by the characters, for real shading/volume
    // instead of flat color) needs light to be visible — a stronger key light
    // plus a dim fill from the opposite side gives clear light/shadow
    // contrast on the rounded body/head without going fully black on one side.
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
    keyLight.position.set(1.2, 1.8, 2)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35)
    fillLight.position.set(-1.5, -0.5, 1.2)
    scene.add(fillLight)

    // The panel's background follows the app's own card token (adapts to
    // light/dark), so these stay mid-tone enough to read against either.
    const colorIdle = new THREE.Color("#6b7280")
    const colorBusy = new THREE.Color("#3b82f6")
    const colorRetry = new THREE.Color("#f59e0b")
    const colorLine = new THREE.Color("#94a3b8")

    const statusColor = (status: SessionStatus["type"]) =>
      status === "busy" ? colorBusy : status === "retry" ? colorRetry : colorIdle

    const linesGroup = new THREE.Group()
    const nodesGroup = new THREE.Group()
    scene.add(linesGroup, nodesGroup)

    const ringGeometry = new THREE.RingGeometry(0.075, 0.09, 24)
    const pulseGeometry = new THREE.SphereGeometry(0.022, 12, 12)

    // A thin status ring under each character's feet — carries the
    // idle/busy/retry color the flat sphere used to (characters keep their
    // own role palette regardless of status).
    const makeRing = () => {
      const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: colorIdle, side: THREE.DoubleSide }))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = CHARACTER_FEET_Y
      return mesh
    }

    const orchestratorCharacter = buildCharacter("orchestrator")
    orchestratorCharacter.group.scale.setScalar(CHARACTER_SCALE)
    orchestratorCharacter.group.rotation.y = BASE_ROTATION_Y
    const orchestratorRing = makeRing()
    nodesGroup.add(orchestratorCharacter.group, orchestratorRing)

    const workerVisuals: WorkerVisual[] = []

    // Each worker's character (materials/geometries) and its line/pulse must
    // be disposed explicitly when dropped — they aren't shared across
    // workers, so their GPU buffers/programs would otherwise leak for the
    // life of the session.
    const disposeVisual = (visual: WorkerVisual) => {
      visual.character.dispose()
      visual.ring.material.dispose()
      visual.line.geometry.dispose()
      visual.line.material.dispose()
    }

    const render = () => renderer.render(scene, camera)

    // Every character animates continuously (a slow idle sway, plus its own
    // random phase offset so a row of workers doesn't move in lockstep) —
    // "busy" swaps to a faster/bigger arm swing and a noticeable bounce on
    // top of that same idle motion, instead of only moving while busy.
    const animate = (character: Character, x: number, y: number, busy: boolean, t: number, phase: number) => {
      const swayFreq = busy ? 3.5 : 1.2
      const swayAmp = busy ? IDLE_SWAY_AMPLITUDE * 1.8 : IDLE_SWAY_AMPLITUDE
      character.group.rotation.y = BASE_ROTATION_Y + Math.sin(t * swayFreq + phase) * swayAmp
      const bob = busy
        ? Math.abs(Math.sin(t * 7 + phase)) * BUSY_BOB_AMPLITUDE
        : Math.sin(t * 1.5 + phase) * IDLE_BOB_AMPLITUDE
      character.group.position.set(x, y + bob, 0)
      character.armPivot.rotation.z = busy
        ? ARM_REST_ROTATION + Math.sin(t * 7 + phase) * ARM_SWING_AMPLITUDE
        : ARM_REST_ROTATION + Math.sin(t * 0.8 + phase) * (IDLE_SWAY_AMPLITUDE * 0.5)
    }

    let raf = 0
    const timer = new THREE.Timer()
    const tick = (now: number) => {
      timer.update(now)
      const dt = timer.getDelta()
      const t = timer.getElapsed()

      const orch = orchestrator()
      animate(orchestratorCharacter, 0, 0, orch?.status.type === "busy", t, 0)

      for (const visual of workerVisuals) {
        animate(visual.character, visual.x, visual.y, visual.busy, t, visual.phase)
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
        nodesGroup.remove(visual.character.group, visual.ring, visual.pulse)
        linesGroup.remove(visual.line)
        disposeVisual(visual)
      }
      while (workerVisuals.length < list.length) {
        const character = buildCharacter("worker")
        character.group.scale.setScalar(CHARACTER_SCALE)
        character.group.rotation.y = BASE_ROTATION_Y
        const ring = makeRing()
        const pulse = new THREE.Mesh(pulseGeometry, new THREE.MeshBasicMaterial({ color: colorBusy }))
        pulse.visible = false
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: colorLine, transparent: true, opacity: 0.5 }),
        )
        nodesGroup.add(character.group, ring, pulse)
        linesGroup.add(line)
        workerVisuals.push({
          character,
          ring,
          line,
          pulse,
          x: 0,
          y: 0,
          pulseT: Math.random(),
          busy: false,
          phase: Math.random() * Math.PI * 2,
        })
      }

      list.forEach(({ node, cos, sin }, index) => {
        const visual = workerVisuals[index]
        const x = cos * RADIUS_WORLD
        const y = -sin * RADIUS_WORLD
        visual.x = x
        visual.y = y
        visual.busy = node.status.type === "busy"
        visual.character.group.position.set(x, y, 0)
        visual.ring.position.set(x, y + CHARACTER_FEET_Y, 0)
        visual.line.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, 0)])
        visual.ring.material.color = statusColor(node.status.type)
      })

      const orch = orchestrator()
      if (orch) orchestratorRing.material.color = statusColor(orch.status.type)

      render()
    }

    createEffect(syncVisuals)

    if (reduced) render()
    else tick(0)

    onCleanup(() => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      workerVisuals.forEach(disposeVisual)
      orchestratorCharacter.dispose()
      orchestratorRing.material.dispose()
      ringGeometry.dispose()
      pulseGeometry.dispose()
      renderer.dispose()
      container?.removeChild(renderer.domElement)
    })
  })

  return (
    <div
      class={`
        relative mx-auto aspect-square w-full max-w-[540px] overflow-hidden rounded-[10px]
        bg-v2-background-bg-layer-01
      `}
      ref={container}
    >
      <div class="pointer-events-none absolute inset-0">
        <Show when={orchestrator()}>
          {(orch) => (
            <div
              class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
              classList={{ "pointer-events-auto cursor-pointer": !!props.onSelectNode }}
              onClick={() => props.onSelectNode?.(orch())}
            >
              <div class="size-28 shrink-0" />
              <span class="mt-2 text-12-medium whitespace-nowrap text-v2-text-text-base">{orch().label}</span>
              <span class="text-11-regular text-v2-text-text-muted">{language.t(statusKey(orch().status.type))}</span>
            </div>
          )}
        </Show>
        <For each={positions()}>
          {({ node, cos, sin }) => (
            <div
              class="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
              classList={{ "pointer-events-auto cursor-pointer": !!props.onSelectNode }}
              style={{ left: `${50 + cos * RADIUS_PERCENT}%`, top: `${50 + sin * RADIUS_PERCENT}%` }}
              onClick={() => props.onSelectNode?.(node)}
            >
              <div class="size-24 shrink-0" />
              <span class="mt-2 text-12-medium whitespace-nowrap text-v2-text-text-base">{node.label}</span>
              <span class="whitespace-nowrap text-11-regular text-v2-text-text-muted">
                {node.tool?.title ?? language.t(statusKey(node.status.type))}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
