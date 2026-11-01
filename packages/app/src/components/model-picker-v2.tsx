import { createEffect, createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { createIntegrationFetchApi } from "@/utils/integration-fetch"

// Legacy prefix support for older stored values like "combo:<id>"
const COMBO_PREFIX = "combo:"

export interface ModelPickerV2Props {
  /** "providerID/modelID", "combo/<id>", "combo:<id>", or empty string when nothing is selected yet */
  value: string
  onChange: (value: string) => void
  /** When provided, the provider dropdown also lists these as selectable combos. */
  combos?: { id: string; name: string }[]
  /** Allow selecting Combos as a provider. Defaults to true (set to false in combo editor to prevent nesting). */
  allowCombos?: boolean
  /**
   * Worktree to scope the provider catalog to. Without this, useProviders()
   * falls back to the global catalog, which misses providers only connected
   * per-project (e.g. Omniroute) — those still show in a real session's
   * chat composer (project-scoped) but silently disappear from this picker.
   * Pass the caller's own directory when one is available (AgentUI); other
   * callers (Memória) have no natural directory and keep the old
   * global-catalog behavior by omitting this.
   */
  directory?: string
  /** Require models supporting vision / image inputs */
  requireVision?: boolean
  /** Require models supporting PDF / document inputs */
  requirePdf?: boolean
  /** Require models supporting audio inputs */
  requireAudio?: boolean
}

function splitModel(value: string) {
  if (!value) return { providerID: "", modelID: "" }
  if (value.startsWith(COMBO_PREFIX)) {
    return { providerID: "combo", modelID: value.slice(COMBO_PREFIX.length) }
  }
  const index = value.indexOf("/")
  if (index === -1) return { providerID: "", modelID: "" }
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

const sortProviders = (a: { id: string; name: string }, b: { id: string; name: string }) => {
  if (a.id === "combo") return -1
  if (b.id === "combo") return 1
  const aIndex = popularProviders.indexOf(a.id)
  const bIndex = popularProviders.indexOf(b.id)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0

  if (aPopular && !bPopular) return -1
  if (!aPopular && bPopular) return 1
  if (aPopular && bPopular) return aIndex - bIndex
  return a.name.localeCompare(b.name)
}

function resolveFallbackProvider(id: string, combos: { id: string; name: string }[], combosTitle: string) {
  if (id === "combo") {
    return {
      id: "combo",
      name: combosTitle,
      models: Object.fromEntries(combos.map((c) => [c.id, { id: c.id, name: c.name }])),
    }
  }
  if (id === "google-antigravity" || id === "google-antigravity-cli") {
    return {
      id,
      name: id === "google-antigravity" ? "AGY" : "AGY CLI",
      models: { ...ANTIGRAVITY_FALLBACK_MODELS },
    }
  }
  return { id, name: id, models: {} }
}

const selectClass = `
  h-8 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-md border border-v2-border-border-base
  bg-v2-background-bg-base bg-[image:var(--model-select-chevron)] bg-[position:right_8px_center] bg-no-repeat
  py-0 pl-2.5 pr-7 text-13-regular text-v2-text-text-base outline-none transition-colors duration-150
  hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-01
  focus-visible:border-v2-border-border-focus focus-visible:outline-none
  disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-v2-background-bg-base
`

const ANTIGRAVITY_FALLBACK_MODELS: Record<string, any> = {
  "gemini-3.8-flash-high": { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  "gemini-3.8-flash-medium": { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  "gemini-3.8-flash-low": { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  "gemini-3.7-flash-high": { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
  "gemini-3.7-flash-medium": { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
  "gemini-3.7-flash-low": { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
  "gemini-pro-agent": { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  "gemini-3.1-pro-low": { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
  "gemini-3.1-flash-lite": { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  "claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  "claude-opus-4-6-thinking": { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  "gpt-oss-120b-medium": { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
}

export const ModelPickerV2: Component<ModelPickerV2Props> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const providers = useProviders(() => props.directory)
  const integrationApi = createMemo(() => createIntegrationFetchApi(serverSdk().server.http))

  let modelsContext: ReturnType<typeof useModels> | undefined
  try {
    modelsContext = useModels()
  } catch {}

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

  const [combosResource] = createResource(async () => {
    if (props.combos && props.combos.length > 0) return props.combos
    try {
      const res = await serverSdk().client.combo.list()
      return (res.data ?? []).map((c) => ({ id: c.id, name: c.name }))
    } catch {
      return []
    }
  })

  const availableCombos = createMemo(() => {
    if (props.combos && props.combos.length > 0) return props.combos
    const fromModels = modelsContext
      ?.list()
      .filter((m) => m.providerID === "combo" || m.provider?.id === "combo")
      .map((m) => ({ id: m.id, name: m.name }))
    if (fromModels && fromModels.length > 0) return fromModels
    const fromResource = combosResource()
    if (fromResource && fromResource.length > 0) return fromResource
    if (props.combos) return props.combos
    return []
  })
  const allowCombos = createMemo(() => props.allowCombos !== false)

  const selectedProviderID = createMemo(() => splitModel(props.value).providerID)
  const selectedModelID = createMemo(() => splitModel(props.value).modelID)

  const providerList = createMemo(() => {
    const extraIntegrations = integrationsList() ?? []
    const integrationMap = new Map(extraIntegrations.map((i) => [i.id, i]))

    const allCatalog = providers.all()
    const seen = new Map<string, { id: string; name: string; models: Record<string, any> }>()

    // Include Combos as a first-class selectable provider (identical to Chat)
    if (allowCombos()) {
      const combos = availableCombos()
      const comboModels: Record<string, any> = {}
      for (const c of combos) {
        comboModels[c.id] = { id: c.id, name: c.name, providerID: "combo" }
      }
      seen.set("combo", {
        id: "combo",
        name: language.t("settings.combos.title"),
        models: comboModels,
      })
    }

    // Filter providers.connected() identically to SettingsProvidersV2:
    // Only keep if it has active connections in integrations or valid configured credentials
    for (const p of providers.connected()) {
      if (p.id === "opencode" && Object.keys(p.models).length === 0) continue
      const integrationID = "integrationID" in p && typeof p.integrationID === "string" ? p.integrationID : undefined
      const integration = integrationMap.get(p.id) ?? (integrationID ? integrationMap.get(integrationID) : undefined)
      if (integration && integration.connections.length === 0) continue

      let models = { ...p.models }
      if (Object.keys(models).length === 0) {
        if (p.id === "google-antigravity" || p.id === "google-antigravity-cli") {
          models = { ...ANTIGRAVITY_FALLBACK_MODELS }
        }
      }

      seen.set(p.id, { id: p.id, name: p.name, models })
    }

    // Include OAuth integrations with active connections (e.g. AGY, AGY CLI, OpenCode OAuth, Omniroute)
    for (const integration of extraIntegrations) {
      if (integration.connections.length > 0) {
        const catalogProvider =
          allCatalog.get(integration.id) ??
          allCatalog.get(integration.id.replace("-cli", "")) ??
          (integration.id === "omniroute" ? allCatalog.get("omnrt") : undefined)

        let models = { ...(catalogProvider?.models ?? {}) }
        if (Object.keys(models).length === 0) {
          if (integration.id === "google-antigravity" || integration.id === "google-antigravity-cli") {
            models = { ...ANTIGRAVITY_FALLBACK_MODELS }
          }
        }

        const providerName =
          integration.id === "google-antigravity"
            ? "AGY"
            : integration.id === "google-antigravity-cli"
              ? "AGY CLI"
              : integration.id === "omniroute"
                ? "Omniroute"
                : integration.name || catalogProvider?.name || integration.id

        const providerID = integration.id === "omniroute" ? "omnrt" : integration.id

        if (!seen.has(providerID)) {
          seen.set(providerID, {
            id: providerID,
            name: providerName,
            models,
          })
        } else {
          const entry = seen.get(providerID)!
          Object.assign(entry.models, models)
        }
      }
    }

    // Include omnrt provider explicitly if present in allCatalog or connected in providers
    const omnrt = allCatalog.get("omnrt") ?? allCatalog.get("omniroute")
    if (omnrt && Object.keys(omnrt.models).length > 0 && !seen.has("omnrt")) {
      seen.set("omnrt", {
        id: "omnrt",
        name: omnrt.name || "Omniroute",
        models: { ...omnrt.models },
      })
    }

    // Ensure the currently selected provider is always present in seen so its option exists in DOM
    const currentPid = selectedProviderID()
    if (currentPid && !seen.has(currentPid)) {
      const fallback = resolveFallbackProvider(currentPid, availableCombos(), language.t("settings.combos.title"))
      seen.set(fallback.id, {
        id: fallback.id,
        name: fallback.name,
        models: fallback.models ?? {},
      })
    }

    return Array.from(seen.values())
      .filter((provider) => (allowCombos() && provider.id === "combo") || Object.keys(provider.models).length > 0)
      .sort(sortProviders)
  })

  const selectedProvider = createMemo(() => {
    const id = selectedProviderID()
    if (!id) return undefined
    const found = providerList().find((provider) => provider.id === id)
    if (found) return found
    return resolveFallbackProvider(id, availableCombos(), language.t("settings.combos.title"))
  })

  const allModels = createMemo(() => {
    const provider = selectedProvider()
    if (!provider) return []
    if (provider.id === "combo") {
      return availableCombos().map((c) => ({
        id: c.id,
        name: c.name,
        providerID: "combo",
      }))
    }
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

    if (props.requireAudio) {
      models = models.filter((m) => {
        const inputCaps = m.capabilities?.input
        if (Array.isArray(inputCaps)) return inputCaps.includes("audio")
        if (inputCaps && typeof inputCaps === "object") return Boolean(inputCaps.audio)
        if (m.modalities?.input) return m.modalities.input.includes("audio")
        return m.id.includes("gemini") || m.id.includes("audio") || m.id.includes("whisper")
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
      return [{ id: selected, name: selected }, ...list]
    }
    return list
  })
  const modelListTruncated = createMemo(() => filteredModels().length > MODEL_RENDER_CAP)

  let providerSelectRef: HTMLSelectElement | undefined
  let modelSelectRef: HTMLSelectElement | undefined

  createEffect(() => {
    const pId = selectedProviderID()
    providerList()
    if (providerSelectRef) {
      providerSelectRef.value = pId || ""
    }
  })

  createEffect(() => {
    const mId = selectedModelID()
    modelList()
    if (modelSelectRef) {
      modelSelectRef.value = mId || ""
    }
  })

  return (
    <div
      class="flex min-w-0 flex-1 items-center gap-2"
      style={{
        "--model-select-chevron": `url("data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 6.5L8 9.5L11 6.5" stroke="%239299A6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        )}")`,
      }}
    >
      <select
        ref={providerSelectRef}
        class={selectClass}
        value={selectedProviderID()}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (!next) return props.onChange("")
          props.onChange(`${next}/`)
        }}
      >
        <option value="">{language.t("batuta.model.provider.placeholder")}</option>
        <For each={providerList()}>{(provider) => <option value={provider.id}>{provider.name}</option>}</For>
      </select>
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
          ref={modelSelectRef}
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
    </div>
  )
}
