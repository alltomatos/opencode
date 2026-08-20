import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { OMNIROUTE_PROVIDER_ID } from "@/components/dialog-connect-omniroute"
import "./settings-v2.css"

type Field = "audioModel" | "transcriptionModel" | "memoryModel"

type Candidate = {
  id: string
  route: string
  /** "ok" = pago/estável sem limite conhecido, "limited" = grátis mas com rate limit relatado */
  tier: "ok" | "limited"
}

// Candidatos curados manualmente contra o catálogo do Omniroute — cada rota tem
// um perfil de custo/limite diferente mesmo apontando pro mesmo modelo upstream
// (ex.: gemini-flash-lite via OpenRouter é pago e estável, via Antigravity/AGY é
// grátis mas estrangula sob uso). Só entram aqui os que já validamos ou que têm
// uma contrapartida validada na mesma família.
const CANDIDATES: Record<Field, Candidate[]> = {
  audioModel: [
    { id: "openrouter/openai/gpt-audio-mini", route: "OpenRouter", tier: "ok" },
    { id: "kc/openai/gpt-audio-mini", route: "Kilocode", tier: "limited" },
    { id: "kilocode/openai/gpt-audio-mini", route: "Kilocode (alt)", tier: "limited" },
    { id: "kc/openai/gpt-audio", route: "Kilocode", tier: "limited" },
  ],
  transcriptionModel: [
    { id: "openrouter/openai/whisper-1", route: "OpenRouter", tier: "ok" },
    { id: "openrouter/openai/whisper-large-v3-turbo", route: "OpenRouter", tier: "ok" },
    { id: "openrouter/openai/whisper-large-v3", route: "OpenRouter", tier: "ok" },
  ],
  memoryModel: [
    { id: "openrouter/google/gemini-3.5-flash-lite", route: "OpenRouter", tier: "ok" },
    { id: "kc/anthropic/claude-haiku-4.5", route: "Kilocode", tier: "limited" },
    { id: "kc/google/gemini-2.5-flash-lite", route: "Kilocode", tier: "limited" },
    { id: "antigravity/gemini-3.1-flash-lite", route: "Antigravity", tier: "limited" },
    { id: "agy/gemini-3.1-flash-lite", route: "AGY", tier: "limited" },
  ],
}

export const DialogBreniacRecommendedModels: Component<{
  current: { audioModel: string; transcriptionModel: string; memoryModel: string }
  onApply: (values: { providerID: string; audioModel: string; transcriptionModel: string; memoryModel: string }) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const providers = useProviders(() => undefined)

  const provider = createMemo(() => providers.all().get(OMNIROUTE_PROVIDER_ID))

  const available = createMemo(() => {
    const p = provider()
    if (!p) return { audioModel: [], transcriptionModel: [], memoryModel: [] } as Record<Field, Candidate[]>
    return {
      audioModel: CANDIDATES.audioModel.filter((c) => p.models[c.id]),
      transcriptionModel: CANDIDATES.transcriptionModel.filter((c) => p.models[c.id]),
      memoryModel: CANDIDATES.memoryModel.filter((c) => p.models[c.id]),
    }
  })

  const currentModelID = (field: Field) => {
    const value = props.current[field]
    const separator = value.indexOf("/")
    return separator === -1 ? value : value.slice(separator + 1)
  }

  const [selected, setSelected] = createSignal<Record<Field, string>>({
    audioModel: currentModelID("audioModel") || available().audioModel[0]?.id || "",
    transcriptionModel: currentModelID("transcriptionModel") || available().transcriptionModel[0]?.id || "",
    memoryModel: currentModelID("memoryModel") || available().memoryModel[0]?.id || "",
  })

  const fields: { field: Field; title: string }[] = [
    { field: "audioModel", title: language.t("settings.breniac.field.audioModel.title") },
    { field: "transcriptionModel", title: language.t("settings.breniac.field.transcriptionModel.title") },
    { field: "memoryModel", title: language.t("settings.breniac.field.memoryModel.title") },
  ]

  const apply = () => {
    const values = selected()
    props.onApply({
      providerID: OMNIROUTE_PROVIDER_ID,
      audioModel: values.audioModel ? `${OMNIROUTE_PROVIDER_ID}/${values.audioModel}` : "",
      transcriptionModel: values.transcriptionModel ? `${OMNIROUTE_PROVIDER_ID}/${values.transcriptionModel}` : "",
      memoryModel: values.memoryModel ? `${OMNIROUTE_PROVIDER_ID}/${values.memoryModel}` : "",
    })
    dialog.close()
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("settings.breniac.recommended.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[60vh]">
        <Show
          when={provider()}
          fallback={<p class="settings-v2-server-dialog-label">{language.t("settings.breniac.recommended.notConnected")}</p>}
        >
          <div class="flex w-full min-w-0 flex-col gap-5">
            <For each={fields}>
              {(row) => (
                <div class="flex w-full min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">{row.title}</label>
                  <Show
                    when={available()[row.field].length > 0}
                    fallback={
                      <p class="settings-v2-models-status">{language.t("settings.breniac.recommended.noneFound")}</p>
                    }
                  >
                    <div class="flex flex-col gap-1.5">
                      <For each={available()[row.field]}>
                        {(candidate) => (
                          <label class="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name={`breniac-${row.field}`}
                              checked={selected()[row.field] === candidate.id}
                              onChange={() => setSelected({ ...selected(), [row.field]: candidate.id })}
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
                                ? language.t("settings.breniac.recommended.tier.ok")
                                : language.t("settings.breniac.recommended.tier.limited")}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!provider()} onClick={apply}>
          {language.t("settings.breniac.recommended.apply")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
