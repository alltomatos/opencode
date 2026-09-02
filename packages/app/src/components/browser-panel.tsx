import { createEffect, createSignal, onCleanup, onMount, Show, type Component } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

type BrowserPanelBounds = { x: number; y: number; width: number; height: number }
type BrowserPanelState = {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserPanelAPI = {
  setBounds: (rect: BrowserPanelBounds | null) => void
  toggle: (visible?: boolean) => Promise<boolean>
  navigate: (url: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  reload: () => Promise<void>
  onStateChanged: (cb: (state: BrowserPanelState) => void) => () => void
}

// `window.api` is declared minimally per call site elsewhere (see app.tsx) —
// cast locally instead of extending the global `Window.api` shape, which
// requires every `declare global` merge to agree on an identical type.
function browserPanelAPI(): BrowserPanelAPI | undefined {
  return (window as unknown as { api?: { browserPanel?: BrowserPanelAPI } }).api?.browserPanel
}

const [open, setOpen] = createSignal(false)

export function isBrowserPanelAvailable() {
  return typeof window !== "undefined" && !!browserPanelAPI()
}

export function isBrowserPanelOpen() {
  return open()
}

export function openBrowserPanel() {
  setOpen(true)
}

export function toggleBrowserPanel() {
  setOpen((value) => !value)
}

export const BrowserPanelOverlay: Component<{ stacked?: boolean }> = (props) => {
  const language = useLanguage()
  let placeholder: HTMLDivElement | undefined
  const [addressInput, setAddressInput] = createSignal("")
  const [state, setState] = createSignal<BrowserPanelState>({
    url: "",
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  })

  const syncBounds = () => {
    const api = browserPanelAPI()
    if (!api) return
    if (!open() || !placeholder) {
      api.setBounds(null)
      return
    }
    const rect = placeholder.getBoundingClientRect()
    api.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }

  onMount(() => {
    const api = browserPanelAPI()
    if (!api) return
    let lastUrl = ""
    const unsubscribe = api.onStateChanged((next) => {
      setState(next)
      setAddressInput(next.url)
      if (next.url && next.url !== "about:blank" && (next.url !== lastUrl || next.isLoading)) {
        lastUrl = next.url
        setOpen(true)
      }
    })
    const resizeObserver = new ResizeObserver(syncBounds)
    if (placeholder) resizeObserver.observe(placeholder)
    window.addEventListener("resize", syncBounds)
    onCleanup(() => {
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener("resize", syncBounds)
    })
  })

  createEffect(() => {
    const visible = open()
    void browserPanelAPI()?.toggle(visible).then(syncBounds)
  })

  return (
    <Show when={isBrowserPanelAvailable() && open()}>
      <div
        classList={{
          "relative flex flex-col bg-v2-background-bg-base": true,
          "w-full h-[45%] min-h-[220px] shrink-0 border-b border-v2-border-border-base": !!props.stacked,
          "w-[420px] shrink-0 h-full border-l border-v2-border-border-base": !props.stacked,
        }}
      >
          <div class="flex items-center gap-2 border-b border-v2-border-base p-2">
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              disabled={!state().canGoBack}
              icon={<Icon name="chevron-left" />}
              aria-label={language.t("browser.panel.back")}
              onClick={() => browserPanelAPI()?.goBack()}
            />
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              disabled={!state().canGoForward}
              icon={<Icon name="chevron-right" />}
              aria-label={language.t("browser.panel.forward")}
              onClick={() => browserPanelAPI()?.goForward()}
            />
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="reset" />}
              aria-label={language.t("browser.panel.reload")}
              onClick={() => browserPanelAPI()?.reload()}
            />
            <form
              class="flex-1"
              onSubmit={(e) => {
                e.preventDefault()
                const value = addressInput().trim()
                if (!value) return
                const url = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`
                void browserPanelAPI()?.navigate(url)
              }}
            >
              <TextInputV2
                type="text"
                appearance="base"
                class="!w-full"
                value={addressInput()}
                placeholder={language.t("browser.panel.address.placeholder")}
                onInput={(e) => setAddressInput(e.currentTarget.value)}
              />
            </form>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="close" />}
              aria-label={language.t("common.close")}
              onClick={() => setOpen(false)}
            />
          </div>
          <div ref={placeholder} class="flex-1 min-h-0" />
        </div>
    </Show>
  )
}
