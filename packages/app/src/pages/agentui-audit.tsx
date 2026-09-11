import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import type { AgentUiAuditEntry } from "@opencode-ai/sdk/v2/types"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import "@/components/settings-v2/settings-v2.css"

type Contact = {
  chatKey: string
  channel: AgentUiAuditEntry["channel"]
  entries: AgentUiAuditEntry[]
  lastTimestamp: number
  lastPreview: string
}

function groupByContact(entries: AgentUiAuditEntry[]): Contact[] {
  const byKey = new Map<string, Contact>()
  for (const entry of entries) {
    const key = `${entry.channel}\0${entry.chatKey}`
    const existing = byKey.get(key)
    if (existing) {
      existing.entries.push(entry)
      if (entry.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = entry.timestamp
        existing.lastPreview = entry.outgoing || entry.incoming
      }
      continue
    }
    byKey.set(key, {
      chatKey: entry.chatKey,
      channel: entry.channel,
      entries: [entry],
      lastTimestamp: entry.timestamp,
      lastPreview: entry.outgoing || entry.incoming,
    })
  }
  return [...byKey.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
}

export const AgentUIAuditPage: Component = () => {
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [selected, setSelected] = createSignal<string | undefined>(undefined)

  const [agent] = createResource(
    () => params.id,
    async (id) => {
      const result = await serverSDK().client.agentui.get({ id })
      return result.data
    },
  )

  const [audit, { refetch }] = createResource(
    () => params.id,
    async (id) => {
      const result = await serverSDK().client.agentui.audit({ id })
      return result.data ?? []
    },
  )

  const contacts = createMemo(() => groupByContact(audit() ?? []))
  const selectedContact = createMemo(() => contacts().find((c) => `${c.channel}\0${c.chatKey}` === selected()))
  const selectedThread = createMemo(() => [...(selectedContact()?.entries ?? [])].sort((a, b) => a.timestamp - b.timestamp))

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="settings-v2-panel">
        <div class="settings-v2-tab-header">
          <div class="settings-v2-tab-header-row flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="outline-chevron-down" class="rotate-90" />}
                aria-label={language.t("common.goBack")}
                onClick={() => (selected() ? setSelected(undefined) : navigate("/agentui"))}
              />
              <h2 class="settings-v2-tab-title">
                {selectedContact()
                  ? selectedContact()!.chatKey
                  : `${language.t("settings.agentui.audit.title")} · ${agent()?.name ?? ""}`}
              </h2>
            </div>
            <ButtonV2 variant="outline" disabled={audit.loading} onClick={() => void refetch()}>
              {audit.loading ? language.t("settings.agentui.audit.loading") : language.t("settings.agentui.audit.refresh")}
            </ButtonV2>
          </div>
        </div>

        <ScrollView class="settings-v2-tab-body flex-1 min-h-0">
          <Show
            when={selectedContact()}
            fallback={
              <div class="flex w-full flex-col gap-3 px-4 py-6">
                <Show when={!audit.loading && contacts().length === 0}>
                  <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.audit.empty")}</p>
                </Show>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={contacts()}>
                    {(contact) => (
                      <button
                        type="button"
                        class={`
                          flex flex-col gap-1.5 rounded-md border border-v2-border-border-base
                          bg-v2-background-bg-layer-01 p-3 text-left transition-colors
                          hover:bg-v2-background-bg-layer-02
                        `}
                        onClick={() => setSelected(`${contact.channel}\0${contact.chatKey}`)}
                      >
                        <div class="flex items-center justify-between text-11-regular text-v2-text-text-faint">
                          <span>{contact.channel}</span>
                          <span>{new Date(contact.lastTimestamp).toLocaleString()}</span>
                        </div>
                        <span class="text-13-medium text-v2-text-text-base truncate">{contact.chatKey}</span>
                        <span class="text-12-regular text-v2-text-text-faint truncate">{contact.lastPreview}</span>
                        <span class="text-11-regular text-v2-text-text-faint">{contact.entries.length}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            <div class="flex w-full flex-col gap-2 px-4 py-6">
              <For each={selectedThread()}>
                {(entry) => (
                  <div class="flex flex-col gap-1.5">
                    <div class="flex max-w-[80%] flex-col gap-1 rounded-md rounded-bl-sm bg-v2-background-bg-layer-01 p-2.5 self-start">
                      <span class="text-11-regular text-v2-text-text-faint">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <p class="text-13-regular text-v2-text-text-base">{entry.incoming}</p>
                    </div>
                    <Show
                      when={entry.outgoing}
                      fallback={
                        <Show when={entry.blocked}>
                          <span class="self-end rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-11-regular text-v2-text-text-accent">
                            {language.t("settings.agentui.audit.blocked")}
                          </span>
                        </Show>
                      }
                    >
                      <div
                        class={`
                          flex max-w-[80%] flex-col gap-1 self-end rounded-md rounded-br-sm bg-v2-background-bg-accent
                          p-2.5
                        `}
                      >
                        <p class="text-13-regular text-v2-text-text-base">{entry.outgoing}</p>
                        <Show when={entry.blocked}>
                          <span class="text-11-regular text-v2-text-text-accent">
                            {language.t("settings.agentui.audit.blocked")}
                          </span>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </ScrollView>
      </div>
    </div>
  )
}
