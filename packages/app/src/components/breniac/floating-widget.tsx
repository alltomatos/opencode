import { createSignal, onCleanup, onMount, Show, type Component } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useBreniac } from "@/context/breniac"
import { useLanguage } from "@/context/language"
import "./floating-widget.css"

const STORAGE_KEY = "breniac-widget-position"
const WIDGET_SIZE = 52
const MARGIN = 16
const DRAG_THRESHOLD_PX = 4

type Position = { x: number; y: number }

function defaultPosition(): Position {
  return {
    x: Math.max(MARGIN, window.innerWidth - WIDGET_SIZE - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - WIDGET_SIZE - MARGIN),
  }
}

function clamp(position: Position): Position {
  const maxX = Math.max(MARGIN, window.innerWidth - WIDGET_SIZE - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - WIDGET_SIZE - MARGIN)
  return { x: Math.min(Math.max(position.x, MARGIN), maxX), y: Math.min(Math.max(position.y, MARGIN), maxY) }
}

function loadPosition(): Position {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPosition()
    const parsed = JSON.parse(raw) as Position
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return defaultPosition()
    return clamp(parsed)
  } catch {
    return defaultPosition()
  }
}

/**
 * Substitui a entrada fixa do Breniac no sidebar (issue do usuário: "deve ser
 * um elemento solto fora do sidebar") — um ícone circular flutuante,
 * arrastável pra qualquer canto da tela, que só existe enquanto o Breniac
 * está ativado nas Configurações. A animação (respiração/pulso) e o caption
 * abaixo comunicam o estado (desligado/ouvindo/pensando/respondendo) sem
 * o usuário precisar adivinhar olhando só a cor.
 */
export const BreniacFloatingWidget: Component = () => {
  const breniac = useBreniac()
  const language = useLanguage()
  const [position, setPosition] = createSignal<Position>({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)

  onMount(() => {
    setPosition(loadPosition())
    const onResize = () => setPosition((prev) => clamp(prev))
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  let dragOffset = { x: 0, y: 0 }
  let moved = 0
  let pointerId: number | undefined

  const onPointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement
    pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // segue sem captura — o navegador ainda entrega os eventos de move/up
    }
    const current = position()
    dragOffset = { x: event.clientX - current.x, y: event.clientY - current.y }
    moved = 0
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    const next = clamp({ x: event.clientX - dragOffset.x, y: event.clientY - dragOffset.y })
    moved += Math.abs(event.movementX) + Math.abs(event.movementY)
    setPosition(next)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    const target = event.currentTarget as HTMLElement
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // já pode ter sido liberado pelo navegador
    }
    pointerId = undefined
    setDragging(false)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position()))
    if (moved < DRAG_THRESHOLD_PX) void breniac.toggle()
  }

  const captionLabel = () =>
    ({
      off: language.t("breniac.state.off"),
      listening: language.t("breniac.state.listening"),
      thinking: language.t("breniac.state.thinking"),
      responding: language.t("breniac.state.responding"),
    })[breniac.phase()]

  return (
    <Show when={breniac.enabled()}>
      <div
        data-component="breniac-floating-widget-wrap"
        style={{ left: `${position().x}px`, top: `${position().y}px` }}
      >
        <button
          type="button"
          data-component="breniac-floating-widget"
          data-phase={breniac.phase()}
          data-dragging={dragging()}
          title={captionLabel()}
          aria-label={language.t("sidebar.breniac")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span data-slot="breniac-widget-ring" />
          <span data-slot="breniac-widget-icon">
            <IconV2 name="breniac" size="normal" />
          </span>
        </button>
        <span data-slot="breniac-widget-caption">{captionLabel()}</span>
      </div>
    </Show>
  )
}
