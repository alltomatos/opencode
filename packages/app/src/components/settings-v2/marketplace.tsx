import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { DialogMcpAddV2 } from "./dialog-mcp-v2"
import "./settings-v2.css"

type SkillsConfig = { paths?: string[]; urls?: string[]; claude?: boolean; codex?: boolean }
type MarketTab = "skills" | "mcp"

const SKILL_SUGGESTIONS = [
  { name: "anthropics/skills", url: "https://github.com/anthropics/skills" },
  { name: "openai/skills", url: "https://github.com/openai/skills" },
  { name: "alltomatos/skills", url: "https://github.com/alltomatos/skills" },
  { name: "skills.sh", url: "https://www.skills.sh/" },
]

const MCP_SUGGESTIONS = [{ name: "Context7", url: "https://mcp.context7.com/mcp" }]
const MCP_CATALOGS = [{ name: "GitHub MCP Registry", url: "https://github.com/mcp" }]

export const SettingsMarketplaceV2: Component<{ onNavigate?: (tab: string) => void }> = (props) => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const dialog = useDialog()
  const [tab, setTab] = createSignal<MarketTab>("skills")
  const [urlInput, setUrlInput] = createSignal("")

  const skillsConfig = () => serverSync().data.config.skills as SkillsConfig | undefined
  const urls = createMemo(() => skillsConfig()?.urls ?? [])

  const writeSkillsConfig = async (next: SkillsConfig) => {
    const config = { skills: next }
    await serverSync().updateConfig(config as Parameters<ReturnType<typeof serverSync>["updateConfig"]>[0])
  }

  const addUrlMutation = useMutation(() => ({
    mutationFn: async (url: string) => {
      const next = Array.from(new Set([...urls(), url]))
      await writeSkillsConfig({ ...skillsConfig(), urls: next })
    },
    onSuccess: () => {
      setUrlInput("")
      props.onNavigate?.("skills")
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const removeUrlMutation = useMutation(() => ({
    mutationFn: async (url: string) => {
      const next = urls().filter((item) => item !== url)
      await writeSkillsConfig({ ...skillsConfig(), urls: next })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const submitUrl = (e: SubmitEvent) => {
    e.preventDefault()
    const url = urlInput().trim()
    if (!url || addUrlMutation.isPending) return
    addUrlMutation.mutate(url)
  }

  const useSkillSuggestion = (url: string) => {
    if (addUrlMutation.isPending) return
    addUrlMutation.mutate(url)
  }

  const openAddMcp = (prefill?: { name: string; url: string }) => {
    dialog.push(() => (
      <DialogMcpAddV2 prefillName={prefill?.name} prefillUrl={prefill?.url} onAdded={() => props.onNavigate?.("mcp")} />
    ))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.marketplace.title")}</h2>
      </div>
      <div class="settings-v2-tab-body settings-v2-models">
        <div class="flex gap-2">
          <ButtonV2
            type="button"
            variant={tab() === "skills" ? "contrast" : "neutral"}
            onClick={() => setTab("skills")}
          >
            {language.t("settings.skills.title")}
          </ButtonV2>
          <ButtonV2 type="button" variant={tab() === "mcp" ? "contrast" : "neutral"} onClick={() => setTab("mcp")}>
            {language.t("settings.mcp.title")}
          </ButtonV2>
        </div>

        <Show when={tab() === "skills"}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.marketplace.skills.add.title")}</h3>
            <p class="settings-v2-provider-description">{language.t("settings.marketplace.skills.add.description")}</p>
            <form onSubmit={submitUrl} class="flex gap-2">
              <TextInputV2
                type="text"
                appearance="base"
                class="!w-full"
                value={urlInput()}
                placeholder={language.t("settings.marketplace.skills.add.placeholder")}
                onInput={(event) => setUrlInput(event.currentTarget.value)}
              />
              <ButtonV2 type="submit" variant="contrast" disabled={addUrlMutation.isPending}>
                {language.t("settings.marketplace.add.button")}
              </ButtonV2>
            </form>

            <Show when={urls().length > 0}>
              <SettingsListV2>
                <For each={urls()}>
                  {(url) => (
                    <SettingsRowV2 title={url} description="">
                      <IconButtonV2
                        type="button"
                        variant="ghost-muted"
                        size="small"
                        icon={<IconV2 name="outline-xmark" />}
                        disabled={removeUrlMutation.isPending}
                        onClick={() => removeUrlMutation.mutate(url)}
                        aria-label={language.t("common.remove")}
                      />
                    </SettingsRowV2>
                  )}
                </For>
              </SettingsListV2>
            </Show>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.marketplace.suggestions.title")}</h3>
            <p class="settings-v2-provider-description">
              {language.t("settings.marketplace.skills.suggestions.description")}
            </p>
            <SettingsListV2>
              <For each={SKILL_SUGGESTIONS}>
                {(item) => (
                  <SettingsRowV2 title={item.name} description={item.url}>
                    <ButtonV2
                      type="button"
                      variant="neutral"
                      size="small"
                      disabled={addUrlMutation.isPending}
                      onClick={() => useSkillSuggestion(item.url)}
                    >
                      {language.t("settings.marketplace.suggestions.use")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>

        <Show when={tab() === "mcp"}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.marketplace.mcp.add.title")}</h3>
            <ButtonV2 type="button" variant="neutral" icon="plus" onClick={() => openAddMcp()}>
              {language.t("settings.mcp.add.button")}
            </ButtonV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.marketplace.suggestions.title")}</h3>
            <SettingsListV2>
              <For each={MCP_SUGGESTIONS}>
                {(item) => (
                  <SettingsRowV2 title={item.name} description={item.url}>
                    <ButtonV2 type="button" variant="neutral" size="small" onClick={() => openAddMcp(item)}>
                      {language.t("settings.marketplace.suggestions.use")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.marketplace.catalogs.title")}</h3>
            <SettingsListV2>
              <For each={MCP_CATALOGS}>
                {(item) => (
                  <SettingsRowV2 title={item.name} description={item.url}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      data-component="button-v2"
                      data-size="small"
                      data-variant="neutral"
                    >
                      {language.t("settings.marketplace.catalogs.view")}
                    </a>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
