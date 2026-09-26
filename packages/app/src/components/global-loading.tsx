import { createMemo, Show, type JSX } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"

export interface GlobalLoadingProps {
  /**
   * Optional custom loading label. Defaults to localized "Carregando..." / "Loading...".
   */
  label?: string
  /**
   * Optional description text below the main loading indicator.
   */
  description?: string
  /**
   * Optional wrapper class.
   */
  class?: string
  /**
   * If true, renders as an absolute/fixed full-bleed overlay.
   */
  overlay?: boolean
  /**
   * If true, renders inside a panel style matching OpenCode v2 design.
   */
  panel?: boolean
  /**
   * Icon size variant: "small" | "normal" | "large". Defaults to "normal".
   */
  size?: "small" | "normal" | "large"
}

export function GlobalLoading(props: GlobalLoadingProps = {}) {
  const language = useLanguage()

  const defaultLabel = createMemo(() => {
    try {
      const isPtBr = language.intl()?.startsWith("pt") || language.intl() === "br"
      if (isPtBr) {
        return "Carregando, aguarde..."
      }
      const loading = language.t("common.loading")
      const ellipsis = language.t("common.loading.ellipsis")
      return `${loading}${ellipsis}`
    } catch {
      return "Carregando, aguarde..."
    }
  })

  const labelText = createMemo(() => props.label ?? defaultLabel())

  const spinnerSize = createMemo(() => {
    switch (props.size) {
      case "small":
        return "size-4"
      case "large":
        return "size-8"
      case "normal":
      default:
        return "size-6"
    }
  })

  return (
    <div
      role="status"
      aria-live="polite"
      class={`
        flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-6 text-center select-none
        ${props.overlay ? "fixed inset-0 z-50 bg-v2-background-bg-deep/80 backdrop-blur-xs" : "size-full"}
        ${props.panel ? "m-2 rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]" : ""}
        ${props.class ?? ""}
      `}
    >
      <div class="flex flex-col items-center justify-center gap-3">
        <div class="relative flex items-center justify-center">
          <Spinner class={`${spinnerSize()} text-v2-text-text-base opacity-80`} />
        </div>
        <div class="flex flex-col items-center gap-1">
          <p class="text-13-medium text-v2-text-text-base tracking-tight font-medium">
            {labelText()}
          </p>
          <Show when={props.description}>
            {(desc) => (
              <p class="text-11-regular text-v2-text-text-muted max-w-sm">
                {desc()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}

export default GlobalLoading
