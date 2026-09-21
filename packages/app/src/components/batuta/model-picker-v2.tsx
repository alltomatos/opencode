import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useServerSDK } from "@/context/server-sdk"
import { createIntegrationFetchApi } from "@/utils/integration-fetch"

// Combo values are encoded as "combo:<id>" so the picker's public contract
// stays a single string everywhere it's already used (Batuta, Memória) —
// callers that don't pass `combos` never see this prefix and behave exactly
// as before.
const COMBO_PREFIX = "combo:"

export interface ModelPickerV2Props {
  /** "providerID/modelID", "combo:<id>", or empty string when nothing is selected yet */
  value: string
  onChange: (value: string) => void
  /** When provided, the provider dropdown also lists these as selectable combos. */
  combos?: { id: string; name: string }[]
  /**
   * Worktree to scope the provider catalog to. Without this, useProviders()
   * falls back to the global catalog, which misses providers only connected
   * per-project (e.g. Omniroute) — those still show in a real session's
   * chat composer (project-scoped) but silently disappear from this picker.
   * Pass the caller's own directory when one is available (AgentUI); other
   * callers (Batuta, Memória) have no natural directory and keep the old
   * global-catalog behavior by omitting this.
   */
  directory?: string
  /** Require models supporting vision / image inputs */
  requireVision?: boolean
  /** Require models supporting PDF / document inputs */
  requirePdf?: boolean
}

function splitModel(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return { providerID: "", modelID: "" }
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

const selectClass = `
  h-8 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-md border border-v2-border-border-base
  bg-v2-background-bg-base bg-[image:var(--batuta-select-chevron)] bg-[position:right_8px_center] bg-no-repeat
  py-0 pl-2.5 pr-7 text-13-regular text-v2-text-text-base outline-none transition-colors duration-150
  hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-01
  focus-visible:border-v2-border-border-focus focus-visible:outline-none
  disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-v2-background-bg-base
`

export const ModelPickerV2: Component<ModelPickerV2Props> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const providers = useProviders(() => props.directory)
  const integrationApi = createMemo(() => createIntegrationFetchApi(serverSdk().server.http))

  const [integrationsList] = createResource(
    () => ({ directory: props.directory }),
    (input) =>
      integrationApi()
        .integration.list({
          location: input.directory ? { directory: input.directory } : undefined,
        })
        .then((res) => res.data)
        .catch(() => []),
  )

  const providerList = createMemo(() => {
    const extraIntegrations = integrationsList() ?? []
    const integrationMap = new Map(extraIntegrations.map((i) => [i.id, i]))

    const allCatalog = providers.all()
    const seen = new Map<string, { id: string; name: string; models: Record<string, any> }>()

    // Filter providers.connected() identically to SettingsProvidersV2:
    // Only keep if it has active connections in integrations or valid configured credentials
    for (const p of providers.connected()) {
      if (p.id === "opencode" && !Object.values(p.models).find((m) => m.cost?.input)) continue
      const integrationID = "integrationID" in p && typeof p.integrationID === "string" ? p.integrationID : undefined
      const integration = integrationMap.get(p.id) ?? (integrationID ? integrationMap.get(integrationID) : undefined)
      if (integration && integration.connections.length === 0) continue

      seen.set(p.id, { id: p.id, name: p.name, models: { ...p.models } })
    }

    // Include OAuth integrations with active connections (e.g. AGY CLI, OpenCode OAuth, Omniroute)
    for (const integration of extraIntegrations) {
      if (integration.connections.length > 0) {
        const catalogProvider = allCatalog.get(integration.id) ?? allCatalog.get(integration.id.replace("-cli", ""))
        const models = catalogProvider?.models ?? {}
        if (!seen.has(integration.id)) {
          seen.set(integration.id, {
            id: integration.id,
            name: integration.name || catalogProvider?.name || integration.id,
            models: { ...models },
          })
        } else {
          const entry = seen.get(integration.id)!
          Object.assign(entry.models, models)
        }
      }
    }

    return Array.from(seen.values())
      .filter((provider) => Object.keys(provider.models).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  const isCombo = createMemo(() => props.value.startsWith(COMBO_PREFIX))
  const selectedComboID = createMemo(() => (isCombo() ? props.value.slice(COMBO_PREFIX.length) : ""))
  const selectedProviderID = createMemo(() => (isCombo() ? "" : splitModel(props.value).providerID))
  const selectedModelID = createMemo(() => splitModel(props.value).modelID)
  const selectedProvider = createMemo(() => providerList().find((provider) => provider.id === selectedProviderID()))
  const allModels = createMemo(() => {
    const provider = selectedProvider()
    if (!provider) return []
    let models = Object.values(provider.models)

    if (props.requireVision) {
      models = models.filter((m) => {
        const inputCaps = m.capabilities?.input
        if (Array.isArray(inputCaps)) return inputCaps.includes("image")
        if (inputCaps && typeof inputCaps === "object") return Boolean(inputCaps.image)
        if (m.modalities?.input) return m.modalities.input.includes("image")
        // Default models known for vision
        return m.attachment || m.id.includes("flash") || m.id.includes("pro") || m.id.includes("vision") || m.id.includes("sonnet") || m.id.includes("opus") || m.id.includes("gpt-4") || m.id.includes("gpt-5")
      })
    }

    if (props.requirePdf) {
      models = models.filter((m) => {
        const inputCaps = m.capabilities?.input
        if (Array.isArray(inputCaps)) return inputCaps.includes("pdf")
        if (inputCaps && typeof inputCaps === "object") return Boolean(inputCaps.pdf)
        if (m.modalities?.input) return m.modalities.input.includes("pdf")
        return m.attachment || m.id.includes("flash") || m.id.includes("pro") || m.id.includes("sonnet")
      })
    }

    return models.sort((a, b) => a.name.localeCompare(b.name))
  })

  // Some providers (OpenRouter, Omniroute, ...) expose thousands of models —
  // rendering every one as a DOM <option> is what actually gets slow, not
  // the fetch (the catalog is already synced client-side). Filter narrows
  // before render, and MODEL_RENDER_CAP keeps an unfiltered/broad list from
  // ever hitting the DOM at full size.
  const MODEL_RENDER_CAP = 200
  const [modelFilter, setModelFilter] = createSignal("")
  const filteredModels = createMemo(() => {
    const query = modelFilter().trim().toLowerCase()
    const all = allModels()
    if (!query) return all
    return all.filter((model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
  })
  const modelList = createMemo(() => {
    const list = filteredModels().slice(0, MODEL_RENDER_CAP)
    const selected = selectedModelID()
    if (selected && !list.some((m) => m.id === selected)) {
      const found = allModels().find((m) => m.id === selected)
      if (found) return [found, ...list]
    }
    return list
  })
  const modelListTruncated = createMemo(() => filteredModels().length > MODEL_RENDER_CAP)

  return (
    <div
      class="flex min-w-0 flex-1 items-center gap-2"
      style={{
        "--batuta-select-chevron": `url("data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 6.5L8 9.5L11 6.5" stroke="%239299A6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        )}")`,
      }}
    >
      <select
        class={selectClass}
        value={isCombo() ? `${COMBO_PREFIX}${selectedComboID()}` : selectedProviderID()}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (!next) return props.onChange("")
          props.onChange(next.startsWith(COMBO_PREFIX) ? next : `${next}/`)
        }}
      >
        <option value="">{language.t("batuta.model.provider.placeholder")}</option>
        <Show when={props.combos && props.combos.length > 0}>
          <optgroup label={language.t("settings.combos.title")}>
            <For each={props.combos}>
              {(combo) => <option value={`${COMBO_PREFIX}${combo.id}`}>{combo.name}</option>}
            </For>
          </optgroup>
        </Show>
        <optgroup label={language.t("batuta.model.provider.placeholder")}>
          <For each={providerList()}>{(provider) => <option value={provider.id}>{provider.name}</option>}</For>
        </optgroup>
      </select>
      <Show when={!isCombo()}>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <Show when={allModels().length > 0}>
            <input
              type="text"
              class="h-8 min-w-0 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-13-regular text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus-visible:border-v2-border-border-focus"
              placeholder={language.t("batuta.model.model.filterPlaceholder")}
              value={modelFilter()}
              onInput={(event) => setModelFilter(event.currentTarget.value)}
            />
          </Show>
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
          <Show when={modelListTruncated()}>
            <span class="text-11-regular text-v2-text-text-faint">
              {language.t("batuta.model.model.truncated", { count: MODEL_RENDER_CAP })}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
