import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, useServer } from "@/context/server"
import { useProviders } from "@/hooks/use-providers"
import { createIntegrationFetchApi } from "@/utils/integration-fetch"

export type MediaCapabilityKind = "image" | "video" | "audio"

export interface GeneratedMediaItem {
  id: string
  kind: MediaCapabilityKind
  url?: string
  b64?: string
  prompt: string
  model: string
  provider: string
  createdAt: number
}

const ANTIGRAVITY_FALLBACK_MODELS: Record<string, any> = {
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

export const MediaPage: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const server = useServer()
  const providers = useProviders(() => undefined)
  const integrationApi = createMemo(() => createIntegrationFetchApi(serverSDK().server.http))

  const [activeKind, setActiveKind] = createSignal<MediaCapabilityKind>("image")
  const [selectedProviderID, setSelectedProviderID] = createSignal<string>("")
  const [selectedModelID, setSelectedModelID] = createSignal<string>("")
  const [modelSearch, setModelSearch] = createSignal<string>("")
  const [prompt, setPrompt] = createSignal<string>("")
  const [imageSize, setImageSize] = createSignal<string>("1024x1024")
  const [generating, setGenerating] = createSignal<boolean>(false)
  const [error, setError] = createSignal<string | null>(null)

  const [history, setHistory] = createStore<GeneratedMediaItem[]>([])

  const [integrationsList] = createResource(
    () => ({ directory: undefined }),
    (input) =>
      integrationApi()
        .integration.list({
          location: input.directory ? { directory: input.directory } : undefined,
        })
        .then((res) => res.data)
        .catch(() => []),
  )

  // Unifica todos os provedores CONECTADOS (providers.connected + integrações OAuth ativas)
  const connectedProvidersList = createMemo(() => {
    const extraIntegrations = integrationsList() ?? []
    const integrationMap = new Map(extraIntegrations.map((i) => [i.id, i]))

    const allCatalog = providers.all()
    const seen = new Map<string, { id: string; name: string; models: Record<string, any> }>()

    for (const p of providers.connected()) {
      if (p.id === "opencode" && !Object.values(p.models).find((m) => m.cost?.input)) continue
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

    const omnrt = allCatalog.get("omnrt") ?? allCatalog.get("omniroute")
    if (omnrt && Object.keys(omnrt.models).length > 0 && !seen.has("omnrt")) {
      seen.set("omnrt", {
        id: "omnrt",
        name: omnrt.name || "Omniroute",
        models: { ...omnrt.models },
      })
    }

    return Array.from(seen.values())
      .filter((provider) => Object.keys(provider.models).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  // Coleta os modelos de provedores conectados
  const allConnectedModels = createMemo(() => {
    const list: Array<{
      providerID: string
      providerName: string
      modelID: string
      modelName: string
      capabilities: {
        input: { text?: boolean; image?: boolean; audio?: boolean; video?: boolean }
        output: { text?: boolean; image?: boolean; audio?: boolean; video?: boolean }
      }
    }> = []

    for (const p of connectedProvidersList()) {
      for (const m of Object.values(p.models)) {
        list.push({
          providerID: p.id,
          providerName: p.name,
          modelID: m.id,
          modelName: m.name || m.id,
          capabilities: {
            input: m.capabilities?.input ?? {},
            output: m.capabilities?.output ?? {},
          },
        })
      }
    }
    return list
  })

  // Filtra modelos por capacidade de mídia
  const compatibleModels = createMemo(() => {
    const kind = activeKind()
    return allConnectedModels().filter((item) => {
      const out = item.capabilities.output
      const inCaps = item.capabilities.input
      const id = item.modelID.toLowerCase()
      const name = item.modelName.toLowerCase()

      if (kind === "image") {
        return (
          out.image === true ||
          id.includes("dall-e") ||
          id.includes("image") ||
          id.includes("flux") ||
          id.includes("midjourney") ||
          id.includes("sd-") ||
          id.includes("stable-diffusion") ||
          id.includes("recraft") ||
          id.includes("imagen") ||
          name.includes("image")
        )
      }
      if (kind === "video") {
        return (
          out.video === true ||
          id.includes("video") ||
          id.includes("sora") ||
          id.includes("runway") ||
          id.includes("kling") ||
          id.includes("wan") ||
          id.includes("hailuo") ||
          id.includes("minimax") ||
          id.includes("veo") ||
          name.includes("video")
        )
      }
      if (kind === "audio") {
        return (
          out.audio === true ||
          inCaps.audio === true ||
          id.includes("audio") ||
          id.includes("speech") ||
          id.includes("tts") ||
          id.includes("whisper") ||
          id.includes("eleven") ||
          id.includes("music") ||
          id.includes("voice") ||
          name.includes("voice") ||
          name.includes("audio")
        )
      }
      return false
    })
  })

  // Lista de provedores conectados (sempre exibe todos os conectados)
  const providerOptions = createMemo(() => {
    return connectedProvidersList().map((p) => ({
      id: p.id,
      name: p.name,
    }))
  })

  // Modelos filtrados pelo provedor selecionado (ou todos compatíveis) e pela busca
  const filteredModels = createMemo(() => {
    const provId = selectedProviderID()
    const query = modelSearch().trim().toLowerCase()

    let models = provId
      ? compatibleModels().filter((m) => m.providerID === provId)
      : compatibleModels()

    if (query) {
      models = models.filter(
        (m) =>
          m.modelID.toLowerCase().includes(query) ||
          m.modelName.toLowerCase().includes(query) ||
          m.providerName.toLowerCase().includes(query),
      )
    }

    return models
  })

  // Modelo atualmente selecionado
  const effectiveModel = createMemo(() => {
    const list = filteredModels()
    if (list.length === 0) return undefined
    const match = list.find((m) => m.modelID === selectedModelID())
    return match ?? list[0]
  })

  const handleGenerate = async () => {
    const currentModel = effectiveModel()
    const currentPrompt = prompt().trim()
    if (!currentModel || !currentPrompt) return

    setGenerating(true)
    setError(null)

    try {
      const focusedConn = server.list.find((s) => ServerConnection.key(s) === server.key)
      const baseUrl =
        focusedConn && "url" in focusedConn && typeof (focusedConn as any).url === "string"
          ? (focusedConn as any).url
          : "http://localhost:4096"

      const kind = activeKind()

      // Endpoint path baseado na modalidade
      const endpoint =
        kind === "image"
          ? "/api/v1/images/generations"
          : kind === "video"
            ? "/api/v1/videos/generations"
            : "/api/v1/audio/speech"

      const body: Record<string, unknown> = {
        model: currentModel.modelID,
        prompt: currentPrompt,
      }

      if (kind === "image") {
        body.size = imageSize()
        body.n = 1
      }

      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-connection-id": currentModel.providerID,
        },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data?.error?.message || data?.message || `HTTP ${res.status}`
        setError(String(msg))
        return
      }

      let url: string | undefined
      let b64: string | undefined

      if (Array.isArray(data?.data) && data.data.length > 0) {
        url = data.data[0]?.url
        b64 = data.data[0]?.b64_json
      } else if (typeof data?.url === "string") {
        url = data.url
      }

      const newItem: GeneratedMediaItem = {
        id: crypto.randomUUID(),
        kind,
        url,
        b64,
        prompt: currentPrompt,
        model: currentModel.modelID,
        provider: currentModel.providerID,
        createdAt: Date.now(),
      }

      setHistory([newItem, ...history])
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("media.error"))
    } finally {
      setGenerating(false)
    }
  }

  const promptPlaceholder = createMemo(() => {
    switch (activeKind()) {
      case "image":
        return language.t("media.prompt.placeholder.image")
      case "video":
        return language.t("media.prompt.placeholder.video")
      case "audio":
        return language.t("media.prompt.placeholder.audio")
    }
  })

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 py-6 lg:px-8">
          {/* Header */}
          <div class="flex items-center gap-3">
            <div class="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-v2-background-bg-layer-01 text-v2-icon-icon-base shadow-[var(--v2-elevation-raised)]">
              <IconV2 name="photo" size="large" class="size-6 text-v2-text-text-base" />
            </div>
            <div class="flex flex-col">
              <h1 class="text-lg font-medium text-v2-text-text-base">{language.t("media.title")}</h1>
              <p class="text-12-regular text-v2-text-text-muted">{language.t("media.description")}</p>
            </div>
          </div>

          {/* Media Kind Selector Tabs */}
          <div class="flex items-center gap-2 border-b border-v2-border-border-base pb-3">
            <button
              type="button"
              class={`
                flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-13-medium transition-colors
                ${activeKind() === "image" ? "bg-v2-background-bg-layer-01 text-v2-text-text-base shadow-[var(--v2-elevation-raised)]" : "text-v2-text-text-muted hover:text-v2-text-text-base"}
              `}
              onClick={() => {
                setActiveKind("image")
                setSelectedModelID("")
              }}
            >
              <IconV2 name="photo" size="small" />
              <span>{language.t("media.kind.image")}</span>
            </button>
            <button
              type="button"
              class={`
                flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-13-medium transition-colors
                ${activeKind() === "video" ? "bg-v2-background-bg-layer-01 text-v2-text-text-base shadow-[var(--v2-elevation-raised)]" : "text-v2-text-text-muted hover:text-v2-text-text-base"}
              `}
              onClick={() => {
                setActiveKind("video")
                setSelectedModelID("")
              }}
            >
              <IconV2 name="monitor" size="small" />
              <span>{language.t("media.kind.video")}</span>
            </button>
            <button
              type="button"
              class={`
                flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-13-medium transition-colors
                ${activeKind() === "audio" ? "bg-v2-background-bg-layer-01 text-v2-text-text-base shadow-[var(--v2-elevation-raised)]" : "text-v2-text-text-muted hover:text-v2-text-text-base"}
              `}
              onClick={() => {
                setActiveKind("audio")
                setSelectedModelID("")
              }}
            >
              <IconV2 name="speech-bubble" size="small" />
              <span>{language.t("media.kind.audio")}</span>
            </button>
          </div>

          {/* Form Controls */}
          <div class="flex flex-col gap-4 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4 shadow-[var(--v2-elevation-raised)]">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Provider Selector */}
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-v2-text-text-muted">{language.t("media.provider")}</label>
                <select
                  class="h-9 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-base px-3 text-13-regular text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
                  value={selectedProviderID()}
                  onChange={(e) => {
                    setSelectedProviderID(e.currentTarget.value)
                    setSelectedModelID("")
                  }}
                >
                  <option value="">{language.t("media.provider.all")}</option>
                  <For each={providerOptions()}>
                    {(p) => <option value={p.id}>{p.name}</option>}
                  </For>
                </select>
              </div>

              {/* Model Selector & Search Filter */}
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <label class="text-12-medium text-v2-text-text-muted">{language.t("media.model")}</label>
                  <span class="text-11-regular text-v2-text-text-faint">
                    {filteredModels().length} {language.t("media.model").toLowerCase()}
                  </span>
                </div>
                <div class="flex flex-col gap-2">
                  <div class="relative flex items-center">
                    <input
                      type="text"
                      placeholder={language.t("media.model.search")}
                      value={modelSearch()}
                      onInput={(e) => setModelSearch(e.currentTarget.value)}
                      class="h-8 w-full rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-12-regular text-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
                    />
                    <Show when={modelSearch()}>
                      <button
                        type="button"
                        onClick={() => setModelSearch("")}
                        class="absolute right-2 text-v2-text-text-muted hover:text-v2-text-text-base"
                      >
                        <IconV2 name="xmark-small" size="small" />
                      </button>
                    </Show>
                  </div>
                  <select
                    class="h-9 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-base px-3 text-13-regular text-v2-text-text-base outline-none focus:border-v2-border-border-focus disabled:opacity-50"
                    value={effectiveModel()?.modelID ?? ""}
                    disabled={filteredModels().length === 0}
                    onChange={(e) => setSelectedModelID(e.currentTarget.value)}
                  >
                    <Show when={filteredModels().length === 0}>
                      <option value="">{language.t("media.noCompatibleModels")}</option>
                    </Show>
                    <For each={filteredModels()}>
                      {(m) => (
                        <option value={m.modelID}>
                          {m.modelName} ({m.providerName})
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </div>
            </div>

            {/* Extra Options for Image */}
            <Show when={activeKind() === "image"}>
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-v2-text-text-muted">{language.t("media.size")}</label>
                <div class="flex flex-wrap gap-2">
                  <For each={["1024x1024", "1792x1024", "1024x1792", "512x512"]}>
                    {(size) => (
                      <button
                        type="button"
                        class={`
                          rounded-[6px] border px-2.5 py-1 text-12-medium transition-colors
                          ${imageSize() === size ? "border-v2-border-border-focus bg-v2-background-bg-base text-v2-text-text-base" : "border-v2-border-border-base bg-transparent text-v2-text-text-muted hover:text-v2-text-text-base"}
                        `}
                        onClick={() => setImageSize(size)}
                      >
                        {size}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Prompt Input */}
            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-v2-text-text-muted">{language.t("media.prompt")}</label>
              <textarea
                class="min-h-[80px] w-full rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-base p-3 text-13-regular text-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
                rows={3}
                placeholder={promptPlaceholder()}
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
              />
            </div>

            {/* Error Banner */}
            <Show when={error()}>
              <div class="rounded-[8px] bg-red-500/10 border border-red-500/20 p-3 text-13-regular text-red-500">
                {error()}
              </div>
            </Show>

            {/* Submit Button */}
            <div class="flex justify-end">
              <button
                type="button"
                disabled={generating() || !effectiveModel() || !prompt().trim()}
                class={`
                  flex items-center gap-2 rounded-[8px] bg-v2-text-text-base px-4 py-2 text-13-medium text-v2-background-bg-base
                  transition-opacity hover:opacity-90 disabled:opacity-40
                `}
                onClick={handleGenerate}
              >
                <Show when={generating()} fallback={<IconV2 name="sparkles" size="small" />}>
                  <IconV2 name="reset" size="small" class="animate-spin" />
                </Show>
                <span>{generating() ? language.t("media.generating") : language.t("media.generate")}</span>
              </button>
            </div>
          </div>

          {/* Results Area */}
          <div class="flex flex-col gap-4">
            <h2 class="text-14-medium text-v2-text-text-base">{language.t("media.results")}</h2>
            <Show
              when={history.length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-v2-border-border-base py-12 text-center text-v2-text-text-muted">
                  <IconV2 name="photo" size="large" class="mb-2 opacity-40" />
                  <p class="text-13-regular">{language.t("media.noResults")}</p>
                </div>
              }
            >
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <For each={history}>
                  {(item) => {
                    const src = () => item.url ?? (item.b64 ? `data:image/png;base64,${item.b64}` : "")
                    return (
                      <div class="flex flex-col overflow-hidden rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-raised)]">
                        <div class="relative flex min-h-[180px] items-center justify-center bg-black/5 dark:bg-white/5">
                          <Show
                            when={item.kind === "image" && src()}
                            fallback={
                              <Show
                                when={item.kind === "video" && item.url}
                                fallback={
                                  <Show
                                    when={item.kind === "audio" && item.url}
                                    fallback={
                                      <div class="p-4 text-xs text-v2-text-text-muted">
                                        {src() || "URL indisponível"}
                                      </div>
                                    }
                                  >
                                    <audio controls src={item.url} class="w-full px-4" />
                                  </Show>
                                }
                              >
                                <video controls src={item.url} class="max-h-[240px] w-full object-contain" />
                              </Show>
                            }
                          >
                            <img src={src()} alt={item.prompt} class="max-h-[240px] w-full object-contain" />
                          </Show>
                        </div>
                        <div class="flex flex-col gap-2 p-3">
                          <p class="line-clamp-2 text-12-regular text-v2-text-text-base" title={item.prompt}>
                            {item.prompt}
                          </p>
                          <div class="flex items-center justify-between text-11-regular text-v2-text-text-faint">
                            <span class="truncate">{item.model}</span>
                            <Show when={src()}>
                              <a
                                href={src()}
                                target="_blank"
                                download={`media-${item.id}`}
                                class="flex items-center gap-1 text-v2-text-text-muted hover:text-v2-text-text-base"
                              >
                                <IconV2 name="download" size="small" />
                                <span>{language.t("media.download")}</span>
                              </a>
                            </Show>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </ScrollView>
    </div>
  )
}
