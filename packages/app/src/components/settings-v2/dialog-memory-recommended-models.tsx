import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { OMNIROUTE_PROVIDER_ID } from "@/components/dialog-connect-omniroute"
import "./settings-v2.css"

type Candidate = {
  id: string
  route: string
  /** "ok" = paid/stable with no known limit, "limited" = free but rate-limited */
  tier: "ok" | "limited"
}

// Curated candidates cross-checked against the Omniroute catalog — mirrors
// the DEFAULT_MODEL_CANDIDATES fallback list in packages/opencode/src/memory/index.ts.
const CANDIDATES: Candidate[] = [
  { id: "google/gemini-3.5-flash-lite", route: "OpenRouter", tier: "ok" },
  { id: "anthropic/claude-haiku-4.5", route: "Kilocode", tier: "limited" },
  { id: "google/gemini-2.5-flash-lite", route: "Kilocode", tier: "limited" },
  { id: "gemini-3.1-flash-lite", route: "Antigravity", tier: "limited" },
  { id: "gemini-3.1-flash-lite", route: "AGY", tier: "limited" },
]

export const DialogMemoryRecommendedModels: Component<{
  current: { memoryModel: string }
  onApply: (values: { memoryModel: string }) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const providers = useProviders(() => undefined)

  const provider = createMemo(() => providers.all().get(OMNIROUTE_PROVIDER_ID))

  const available = createMemo(() => {
    const p = provider()
    if (!p) return [] as Candidate[]
    return CANDIDATES.filter((c) => p.models[c.id])
  })

  const currentModelID = () => {
    const value = props.current.memoryModel
    const separator = value.indexOf("/")
    return separator === -1 ? value : value.slice(separator + 1)
  }

  const [selected, setSelected] = createSignal(currentModelID() || available()[0]?.id || "")

  const apply = () => {
    const value = selected()
    props.onApply({
      memoryModel: value ? `${OMNIROUTE_PROVIDER_ID}/${value}` : "",
    })
    dialog.close()
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("settings.memory.recommended.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[60vh]">
        <Show
          when={provider()}
          fallback={<p class="settings-v2-server-dialog-label">{language.t("settings.memory.recommended.notConnected")}</p>}
        >
          <div class="flex w-full min-w-0 flex-col gap-5">
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">
                {language.t("settings.memory.field.memoryModel.title")}
              </label>
              <Show
                when={available().length > 0}
                fallback={<p class="settings-v2-models-status">{language.t("settings.memory.recommended.noneFound")}</p>}
              >
                <div class="flex flex-col gap-1.5">
                  <For each={available()}>
                    {(candidate) => (
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="memory-model"
                          checked={selected() === candidate.id}
                          onChange={() => setSelected(candidate.id)}
                        />
                        <span class="flex-1">{candidate.id}</span>
                        <span
                          classList={{
                            "text-v2-text-text-faint": candidate.tier === "ok",
                            "text-v2-state-fg-warning": candidate.tier === "limited",
                          }}
                        >
                          {candidate.route} ·{" "}
                          {candidate.tier === "ok"
                            ? language.t("settings.memory.recommended.tier.ok")
                            : language.t("settings.memory.recommended.tier.limited")}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!provider()} onClick={apply}>
          {language.t("settings.memory.recommended.apply")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
