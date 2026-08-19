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

const selectClass = `
  h-8 min-w-0 flex-1 truncate rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2
  text-13-regular text-v2-text-text-base outline-none
  focus-visible:border-v2-border-border-focus
`

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
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <select
        class={selectClass}
        value={selectedProviderID()}
        onChange={(event) => props.onChange(event.currentTarget.value ? `${event.currentTarget.value}/` : "")}
      >
        <option value="">{language.t("batuta.model.provider.placeholder")}</option>
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
        <option value="">{language.t("batuta.model.model.placeholder")}</option>
        <For each={modelList()}>{(model) => <option value={model.id}>{model.name}</option>}</For>
      </select>
    </div>
  )
}
