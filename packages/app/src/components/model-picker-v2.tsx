import { createMemo, For, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"

export interface ModelPickerV2Props {
  /** "providerID/modelID" or empty string when nothing is selected yet */
  value: string
  onChange: (value: string) => void
}

function splitModel(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return { providerID: "", modelID: "" }
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

/** Shared styling for a plain <select> that matches the rest of the v2 design system. */
export const nativeSelectClassV2 = `
  h-8 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-md border border-v2-border-border-base
  bg-v2-background-bg-base bg-[image:var(--model-picker-chevron)] bg-[position:right_8px_center] bg-no-repeat
  py-0 pl-2.5 pr-7 text-13-regular text-v2-text-text-base outline-none transition-colors duration-150
  hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-01
  focus-visible:border-v2-border-border-focus focus-visible:outline-none
  disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-v2-background-bg-base
`
const selectClass = nativeSelectClassV2

/** Inline style providing the --model-picker-chevron custom property `nativeSelectClassV2` relies on. */
export const nativeSelectChevronStyle = {
  "--model-picker-chevron": `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 6.5L8 9.5L11 6.5" stroke="%239299A6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  )}")`,
} as const

/**
 * Provider+model picker backed by plain <select> elements rather than the
 * app's SelectV2 (Kobalte-based): SelectV2 renders an empty listbox against
 * the full ~200-provider catalog (confirmed by manual testing), so this
 * sidesteps it instead of debugging the library. Originally built for
 * Batuta, reused as-is for Breniac's settings tab.
 */
export const ModelPickerV2: Component<ModelPickerV2Props> = (props) => {
  const language = useLanguage()
  const providers = useProviders(() => undefined)

  const providerList = createMemo(() =>
    Array.from(providers.all().values()).sort((a, b) => a.name.localeCompare(b.name)),
  )
  const selectedProviderID = createMemo(() => splitModel(props.value).providerID)
  const selectedModelID = createMemo(() => splitModel(props.value).modelID)
  const selectedProvider = createMemo(() => providerList().find((provider) => provider.id === selectedProviderID()))
  const modelList = createMemo(() => {
    const provider = selectedProvider()
    if (!provider) return []
    return Object.values(provider.models).sort((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <div class="flex min-w-0 flex-1 items-center gap-2" style={nativeSelectChevronStyle}>
      <select
        class={selectClass}
        value={selectedProviderID()}
        onChange={(event) => props.onChange(event.currentTarget.value ? `${event.currentTarget.value}/` : "")}
      >
        <option value="">{language.t("modelPicker.provider.placeholder")}</option>
        <For each={providerList()}>{(provider) => <option value={provider.id}>{provider.name}</option>}</For>
      </select>
      <select
        class={selectClass}
        disabled={!selectedProvider()}
        value={selectedModelID()}
        onChange={(event) => {
          const provider = selectedProvider()
          if (!provider || !event.currentTarget.value) return
          props.onChange(`${provider.id}/${event.currentTarget.value}`)
        }}
      >
        <option value="">{language.t("modelPicker.model.placeholder")}</option>
        <For each={modelList()}>{(model) => <option value={model.id}>{model.name}</option>}</For>
      </select>
    </div>
  )
}
