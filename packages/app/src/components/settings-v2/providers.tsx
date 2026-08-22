import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { showToast } from "@/utils/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, createSignal, type Accessor, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
import { DialogCustomProvider } from "../dialog-custom-provider"
import { OMNIROUTE_PROVIDER_ID } from "../dialog-connect-omniroute"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const VIEW_STORAGE_KEY = "settings.providers.view"

export type ProviderView = "list" | "grid"

function loadProviderView(): ProviderView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return stored === "grid" ? "grid" : "list"
  } catch {
    return "list"
  }
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.5 5.83h9.17M7.5 10h9.17M7.5 14.17h9.17M3.33 5.83h.01M3.33 10h.01M3.33 14.17h.01"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.33" y="3.33" width="5.83" height="5.83" rx="1" stroke="currentColor" stroke-width="1.5" />
      <rect x="10.83" y="3.33" width="5.83" height="5.83" rx="1" stroke="currentColor" stroke-width="1.5" />
      <rect x="3.33" y="10.83" width="5.83" height="5.83" rx="1" stroke="currentColor" stroke-width="1.5" />
      <rect x="10.83" y="10.83" width="5.83" height="5.83" rx="1" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

export const ProviderViewToggle: Component<{ view: Accessor<ProviderView>; onChange: (view: ProviderView) => void }> = (
  props,
) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-view-toggle">
      <IconButtonV2
        variant="ghost-muted"
        size="small"
        aria-label={language.t("settings.providers.view.list")}
        aria-pressed={props.view() === "list"}
        classList={{ "settings-v2-view-toggle-active": props.view() === "list" }}
        icon={<ListIcon />}
        onClick={() => props.onChange("list")}
      />
      <IconButtonV2
        variant="ghost-muted"
        size="small"
        aria-label={language.t("settings.providers.view.grid")}
        aria-pressed={props.view() === "grid"}
        classList={{ "settings-v2-view-toggle-active": props.view() === "grid" }}
        icon={<GridIcon />}
        onClick={() => props.onChange("grid")}
      />
    </div>
  )
}

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
  { match: (id: string) => id === OMNIROUTE_PROVIDER_ID, key: "dialog.provider.omniroute.note" },
] as const

const PROVIDER_ICON_SIZE = 16

export const SettingsProvidersV2: Component<{
  directory: Accessor<string | undefined>
  onBack?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const providers = useProviders(props.directory)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })
  const [view, setView] = createSignal<ProviderView>(loadProviderView())
  const [query, setQuery] = createSignal("")

  const changeView = (next: ProviderView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider directory={props.directory} controller={providerConnect} />)
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    if (!connectedIDs.has(OMNIROUTE_PROVIDER_ID) && !items.some((p) => p.id === OMNIROUTE_PROVIDER_ID)) {
      items.push({ id: OMNIROUTE_PROVIDER_ID, name: "Omniroute" } as ProviderItem)
    }
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const others = createMemo(() => {
    const q = query().trim().toLowerCase()
    const shownIDs = new Set([...connected().map((p) => p.id), ...popular().map((p) => p.id)])
    return Array.from(providers.all().values())
      .filter((p) => !shownIDs.has(p.id))
      .filter((p) => !q || `${p.id} ${p.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) =>
    source(item) !== "env" && (protocol() === "v1" || !isConfigCustom(item.id))

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    if (protocol() !== "v1") return
    const before = serverSync().data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    serverSync().set("config", "disabled_providers", next)

    await serverSync()
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        serverSync().set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await serverSdk()
        .client.auth.remove({ providerID })
        .catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await serverSdk()
      .client.auth.remove({ providerID })
      .then(async () => {
        await serverSdk().client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.providers.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers">
        <div class="settings-v2-section" data-component="connected-providers-section">
          <h3 class="settings-v2-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsListV2>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="settings-v2-provider-empty">{language.t("settings.providers.connected.empty")}</div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="settings-v2-provider-row group">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name truncate">{item.name}</span>
                        <Tag>{type(item)}</Tag>
                      </div>
                    </div>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="settings-v2-provider-env-hint">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                        onClick={() => void disconnect(item.id, item.name)}
                      >
                        {language.t("common.disconnect")}
                      </ButtonV2>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <div class="settings-v2-section-header-row">
            <h3 class="settings-v2-section-title">{language.t("settings.providers.section.popular")}</h3>
            <ProviderViewToggle view={view} onChange={changeView} />
          </div>
          <Show
            when={view() === "grid"}
            fallback={
              <SettingsListV2>
                <For each={popular()}>
                  {(item) => (
                    <div class="settings-v2-provider-row">
                      <div class="settings-v2-provider-lead">
                        <ProviderIcon
                          id={item.id}
                          width={PROVIDER_ICON_SIZE}
                          height={PROVIDER_ICON_SIZE}
                          class="settings-v2-provider-icon shrink-0"
                        />
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name">{item.name}</span>
                            <Show
                              when={
                                item.id === OMNIROUTE_PROVIDER_ID ||
                                item.id === "opencode" ||
                                item.id === "opencode-go"
                              }
                            >
                              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                            </Show>
                          </div>
                          <Show when={note(item.id)}>
                            {(key) => <p class="settings-v2-provider-description">{language.t(key())}</p>}
                          </Show>
                        </div>
                      </div>
                      <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                        {language.t("common.connect")}
                      </ButtonV2>
                    </div>
                  )}
                </For>

                <Show when={protocol() === "v1"}>
                  <div class="settings-v2-provider-row" data-component="custom-provider-section">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id="synthetic"
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-copy">
                        <div class="settings-v2-provider-main">
                          <span class="settings-v2-provider-name">{language.t("provider.custom.title")}</span>
                          <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                        </div>
                        <p class="settings-v2-provider-description">
                          {language.t("settings.providers.custom.description")}
                        </p>
                      </div>
                    </div>
                    <ButtonV2
                      size="normal"
                      variant="neutral"
                      icon="plus"
                      onClick={() => {
                        dialog.show(() => <DialogCustomProvider onBack={dialog.close} />)
                      }}
                    >
                      {language.t("common.connect")}
                    </ButtonV2>
                  </div>
                </Show>
              </SettingsListV2>
            }
          >
            <div class="settings-v2-provider-grid">
              <For each={popular()}>
                {(item) => (
                  <button type="button" class="settings-v2-provider-card" onClick={() => connect(item.id)}>
                    <ProviderIcon
                      id={item.id}
                      width={20}
                      height={20}
                      class="settings-v2-provider-icon shrink-0"
                    />
                    <span class="settings-v2-provider-card-name truncate">{item.name}</span>
                    <Show
                      when={item.id === OMNIROUTE_PROVIDER_ID || item.id === "opencode" || item.id === "opencode-go"}
                    >
                      <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                    </Show>
                  </button>
                )}
              </For>

              <Show when={protocol() === "v1"}>
                <button
                  type="button"
                  class="settings-v2-provider-card"
                  data-component="custom-provider-section"
                  onClick={() => dialog.show(() => <DialogCustomProvider onBack={dialog.close} />)}
                >
                  <ProviderIcon id="synthetic" width={20} height={20} class="settings-v2-provider-icon shrink-0" />
                  <span class="settings-v2-provider-card-name truncate">{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </button>
              </Show>
            </div>
          </Show>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("dialog.provider.viewAll")}</h3>
          <TextInputV2
            type="search"
            class="!w-full"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            placeholder={language.t("dialog.provider.search.placeholder")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />

          <Show
            when={others().length > 0}
            fallback={<div class="settings-v2-provider-empty">{language.t("dialog.provider.empty")}</div>}
          >
            <Show
              when={view() === "grid"}
              fallback={
                <SettingsListV2>
                  <For each={others()}>
                    {(item) => (
                      <div class="settings-v2-provider-row">
                        <div class="settings-v2-provider-lead">
                          <ProviderIcon
                            id={item.id}
                            width={PROVIDER_ICON_SIZE}
                            height={PROVIDER_ICON_SIZE}
                            class="settings-v2-provider-icon shrink-0"
                          />
                          <span class="settings-v2-provider-name">{item.name}</span>
                        </div>
                        <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                          {language.t("common.connect")}
                        </ButtonV2>
                      </div>
                    )}
                  </For>
                </SettingsListV2>
              }
            >
              <div class="settings-v2-provider-grid">
                <For each={others()}>
                  {(item) => (
                    <button type="button" class="settings-v2-provider-card" onClick={() => connect(item.id)}>
                      <ProviderIcon id={item.id} width={20} height={20} class="settings-v2-provider-icon shrink-0" />
                      <span class="settings-v2-provider-card-name truncate">{item.name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </>
  )
}
