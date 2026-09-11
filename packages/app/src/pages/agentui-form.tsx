import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Icon } from "@opencode-ai/ui/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { createHomeController } from "@/pages/home/home-controller"
import { showToast } from "@/utils/toast"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import { DialogAgentUISandbox } from "@/components/settings-v2/dialog-agentui-sandbox"
import {
  WHATSAPP_PROVIDER_FIELDS,
  WHATSAPP_PROVIDER_LABELS,
  WHATSAPP_PROVIDER_LINKS,
  type WhatsAppProvider,
} from "@/components/settings-v2/whatsapp-providers"
import "@/components/settings-v2/settings-v2.css"

type RagSource = { id: string; kind: "text" | "url"; label: string; value: string }
type AgentUIFormState = {
  id: string
  name: string
  personality: string
  model: string
  commandTriggers: string
  ragSources: RagSource[]
  guardrailsEnabled: boolean
  guardrailsLevel: "basic" | "strict"
  telegram: boolean
  telegramToken: string
  whatsapp: boolean
  whatsappProvider: WhatsAppProvider
  whatsappConfig: Record<string, string>
  whatsappSessionIds: string[]
  whatsappAllowedGroups: string[]
  whatsappWebhookSecret: string
  mcpServers: string[]
  enabled: boolean
}

function emptyForm(): AgentUIFormState {
  return {
    id: crypto.randomUUID(),
    name: "",
    personality: "",
    model: "",
    commandTriggers: "!",
    ragSources: [],
    guardrailsEnabled: true,
    guardrailsLevel: "basic",
    telegram: false,
    telegramToken: "",
    whatsapp: false,
    whatsappProvider: "izapia",
    whatsappConfig: {},
    whatsappSessionIds: [],
    whatsappAllowedGroups: [],
    whatsappWebhookSecret: "",
    mcpServers: [],
    enabled: true,
  }
}

export function AgentUIFormPage() {
  const navigate = useNavigate()
  const params = useParams<{ id?: string }>()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const isEdit = !!params.id

  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const home = createHomeController()
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return home.project.selected()?.worktree ?? home.project.newSession()?.worktree
  })

  const [combos] = createResource(async () => {
    const result = await serverSDK().client.combo.list()
    return (result.data ?? []).map((c) => ({ id: c.id, name: c.name }))
  })

  // MCP servers this agent could be given tool access to — scoped to
  // whichever connected project's config the agent's channels/sandbox run
  // against (same `directory` model.ts and the WhatsApp/Telegram bindings
  // already use). Re-fetches whenever the directory changes since MCP
  // config is per-project, not global.
  const [mcpServers] = createResource(directory, async (dir) => {
    if (!dir) return []
    const result = await serverSDK().client.mcp.status({ directory: dir })
    return Object.keys(result.data ?? {})
  })

  const [existing] = createResource(
    () => params.id,
    async (id) => {
      const result = await serverSDK().client.agentui.get({ id })
      return result.data
    },
  )
  const ready = createMemo(() => !isEdit || existing.state === "ready")

  const [form, setForm] = createStore<AgentUIFormState>(emptyForm())
  const [everSaved, setEverSaved] = createSignal(isEdit)
  let initialized = false

  createEffect(() => {
    const agent = existing()
    if (!agent || initialized) return
    initialized = true
    setForm({
      id: agent.id,
      name: agent.name,
      personality: agent.personality,
      model: agent.model,
      commandTriggers: agent.commandTriggers.join(" "),
      ragSources: agent.ragSources.map((s) => ({ id: s.id, kind: s.kind as "text" | "url", label: s.label, value: s.value })),
      guardrailsEnabled: agent.guardrails.enabled,
      guardrailsLevel: agent.guardrails.level,
      telegram: agent.channels.some((c) => c.type === "telegram"),
      telegramToken: agent.channels.find((c) => c.type === "telegram")?.token ?? "",
      whatsapp: agent.channels.some((c) => c.type === "whatsapp"),
      whatsappProvider: (agent.channels.find((c) => c.type === "whatsapp")?.provider as WhatsAppProvider) ?? "waha",
      whatsappConfig: agent.channels.find((c) => c.type === "whatsapp")?.config ?? {},
      whatsappSessionIds: [...(agent.channels.find((c) => c.type === "whatsapp")?.sessionIds ?? [])],
      whatsappAllowedGroups: [...(agent.channels.find((c) => c.type === "whatsapp")?.allowedGroups ?? [])],
      whatsappWebhookSecret: agent.channels.find((c) => c.type === "whatsapp")?.webhookSecret ?? "",
      mcpServers: agent.mcpServers ?? [],
      enabled: agent.enabled !== false,
    })
  })

  const addRagSource = () =>
    setForm("ragSources", (list) => [...list, { id: crypto.randomUUID(), kind: "text", label: "", value: "" }])
  const removeRagSource = (id: string) => setForm("ragSources", (list) => list.filter((s) => s.id !== id))

  const toggleMcpServer = (name: string, checked: boolean) =>
    setForm("mcpServers", (list) => (checked ? [...list, name] : list.filter((item) => item !== name)))

  // izapia-only: fetches the tenant's existing WhatsApp sessions for the
  // API key already typed in, so the person can pick one instead of going
  // to find and paste a sid by hand from the izapia dashboard.
  const [izapiaSessions, setIzapiaSessions] = createSignal<
    { id: string; name?: string; status: string; jid?: string }[]
  >([])
  const [izapiaSessionsLoading, setIzapiaSessionsLoading] = createSignal(false)
  const [izapiaSessionsError, setIzapiaSessionsError] = createSignal<string | undefined>()

  const fetchIzapiaSessions = async () => {
    const apiKey = form.whatsappConfig.apiKey?.trim()
    if (!apiKey || izapiaSessionsLoading()) return
    setIzapiaSessionsError(undefined)
    setIzapiaSessionsLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.izapiaSessions({ apiKey })
      setIzapiaSessions(result.data ?? [])
      if (!result.data?.length) setIzapiaSessionsError(language.t("settings.agentui.field.whatsapp.izapiaSessions.empty"))
    } catch (cause) {
      setIzapiaSessionsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIzapiaSessionsLoading(false)
    }
  }

  const toggleIzapiaSession = (id: string, checked: boolean) => {
    setForm("whatsappSessionIds", (list) => (checked ? [...list, id] : list.filter((item) => item !== id)))
    // Group access was scoped to the sessions previously selected — drop
    // anything that no longer belongs to any selected session once the
    // session set changes, rather than silently keeping a stale allow-list.
    setIzapiaGroups([])
    setIzapiaGroupsError(undefined)
    setForm("whatsappAllowedGroups", [])
  }

  // izapia-only, second step: once at least one session is picked, fetches
  // the groups those sessions belong to so the person can check exactly
  // which ones the agent should be allowed to answer in (see
  // ConfigAgentUIV1.WhatsAppChannelBinding.allowedGroups — direct messages
  // are always answered regardless of this list).
  const [izapiaGroups, setIzapiaGroups] = createSignal<
    { id: string; subject: string; sessionId: string; participantCount: number }[]
  >([])
  const [izapiaGroupsLoading, setIzapiaGroupsLoading] = createSignal(false)
  const [izapiaGroupsError, setIzapiaGroupsError] = createSignal<string | undefined>()

  const fetchIzapiaGroups = async () => {
    const apiKey = form.whatsappConfig.apiKey?.trim()
    if (!apiKey || form.whatsappSessionIds.length === 0 || izapiaGroupsLoading()) return
    setIzapiaGroupsError(undefined)
    setIzapiaGroupsLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.izapiaGroups({ apiKey, sids: form.whatsappSessionIds })
      setIzapiaGroups(result.data ?? [])
      if (!result.data?.length) setIzapiaGroupsError(language.t("settings.agentui.field.whatsapp.izapiaGroups.empty"))
    } catch (cause) {
      setIzapiaGroupsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIzapiaGroupsLoading(false)
    }
  }

  const toggleIzapiaGroup = (id: string, checked: boolean) =>
    setForm("whatsappAllowedGroups", (list) => (checked ? [...list, id] : list.filter((item) => item !== id)))

  // Audit log: one row per real turn (incoming message + the agent's
  // reply), across every channel — see AgentUI.Service.logAudit. A dedicated
  // full-page view (AgentUIAuditPage, /agentui/:id/audit), not a tab here —
  // an agent can have hundreds of distinct conversations, which needs a
  // contact-list-then-thread layout this narrow sidebar tab isn't built for.

  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  // "Criar com IA": one-shot generation, not a conversation — the user
  // describes the agent once, the draft lands in the form fields below for
  // review/editing, same as if they'd typed it by hand. Open by default
  // only for a brand-new agent; editing an existing one hides it until
  // asked for, so it can't be mistaken for "regenerate this agent".
  const [aiOpen, setAiOpen] = createSignal(!isEdit)
  const [aiDescription, setAiDescription] = createSignal("")
  const [aiGenerating, setAiGenerating] = createSignal(false)
  const [aiError, setAiError] = createSignal<string | undefined>()

  const generateWithAI = async () => {
    if (!aiDescription().trim() || aiGenerating()) return
    setAiError(undefined)
    setAiGenerating(true)
    try {
      const result = await serverSDK().client.agentui.generate({ description: aiDescription() })
      const draft = result.data
      if (!draft) throw new Error(language.t("common.requestFailed"))
      setForm("name", draft.name)
      setForm("personality", draft.personality)
      setForm("commandTriggers", draft.commandTriggers.join(" "))
      setForm("guardrailsEnabled", draft.guardrails.enabled)
      setForm("guardrailsLevel", draft.guardrails.level as "basic" | "strict")
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.agentui.ai.toast.generated") })
      setAiOpen(false)
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAiGenerating(false)
    }
  }

  const save = async () => {
    if (!form.name.trim() || !form.model) {
      setError(language.t("settings.agentui.error.incomplete"))
      return
    }
    const ownBotToken = form.telegram ? form.telegramToken.trim() : ""
    if (ownBotToken && !directory()) {
      setError(language.t("settings.agentui.error.telegramNeedsProject"))
      return
    }
    const whatsappFields = WHATSAPP_PROVIDER_FIELDS[form.whatsappProvider]
    const whatsappMissingField = form.whatsapp && whatsappFields.some((f) => f.required && !form.whatsappConfig[f.key]?.trim())
    const whatsappMissingSession =
      form.whatsapp && form.whatsappProvider === "izapia" && form.whatsappSessionIds.length === 0
    if (form.whatsapp && (!directory() || whatsappMissingField || whatsappMissingSession)) {
      setError(language.t("settings.agentui.error.whatsappIncomplete"))
      return
    }
    setError(undefined)
    setSaving(true)
    const triggers = form.commandTriggers
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    const channels: Array<
      | { type: "telegram"; token?: string; directory?: string }
      | {
          type: "whatsapp"
          provider: WhatsAppProvider
          config: Record<string, string>
          sessionIds?: string[]
          allowedGroups?: string[]
          directory?: string
          webhookSecret: string
        }
    > = []
    if (form.telegram) channels.push({ type: "telegram", token: ownBotToken || undefined, directory: ownBotToken ? directory() : undefined })
    const whatsappWebhookSecret = form.whatsappWebhookSecret || crypto.randomUUID()
    if (form.whatsapp) {
      channels.push({
        type: "whatsapp",
        provider: form.whatsappProvider,
        config: form.whatsappConfig,
        sessionIds: form.whatsappProvider === "izapia" ? form.whatsappSessionIds : undefined,
        allowedGroups: form.whatsappProvider === "izapia" ? form.whatsappAllowedGroups : undefined,
        directory: directory(),
        webhookSecret: whatsappWebhookSecret,
      })
    }
    try {
      await serverSDK().client.agentui.add({
        agentUiAgent: {
          id: form.id,
          name: form.name,
          personality: form.personality,
          model: form.model,
          channels,
          commandTriggers: triggers,
          ragSources: form.ragSources.filter((s) => s.label && s.value),
          guardrails: { enabled: form.guardrailsEnabled, level: form.guardrailsLevel },
          mcpServers: form.mcpServers,
          enabled: form.enabled,
        },
      })
      if (form.whatsapp) setForm("whatsappWebhookSecret", whatsappWebhookSecret)
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.agentui.toast.saved") })
      setEverSaved(true)
      if (!isEdit) navigate(`/agentui/${form.id}/edit`, { replace: true })
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setSaving(false)
    }
  }

  const openSandbox = () => {
    if (!everSaved()) return
    dialog.push(() => <DialogAgentUISandbox agentID={form.id} agentName={form.name || "—"} directory={directory()} />)
  }

  const title = createMemo(() =>
    isEdit ? language.t("settings.agentui.form.title.edit") : language.t("settings.agentui.form.title.create"),
  )

  // server.url is the opencode API base the app itself talks to — for a
  // desktop install that's 127.0.0.1/localhost, which no remote waconector
  // provider can ever call back into. publicTunnelUrl (a cloudflared quick
  // tunnel, see Tunnel.Service) stands in for it once started; the webhook
  // link below prefers it whenever the raw server URL is a private/loopback
  // address.
  const PRIVATE_HOST_PATTERN = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|localhost)/i
  const isPrivateServerUrl = createMemo(() => {
    try {
      return PRIVATE_HOST_PATTERN.test(new URL(serverSDK().url).hostname)
    } catch {
      return false
    }
  })

  const [publicTunnelUrl, setPublicTunnelUrl] = createSignal<string | undefined>()
  const [tunnelStarting, setTunnelStarting] = createSignal(false)
  const [tunnelError, setTunnelError] = createSignal<string | undefined>()

  const startPublicTunnel = async () => {
    if (tunnelStarting()) return
    setTunnelError(undefined)
    setTunnelStarting(true)
    try {
      const port = Number(new URL(serverSDK().url).port) || 80
      const result = await serverSDK().client.tunnel.start({ port })
      if (result.data?.url) setPublicTunnelUrl(result.data.url)
      else setTunnelError(language.t("settings.agentui.field.whatsapp.tunnel.error"))
    } catch (cause) {
      setTunnelError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTunnelStarting(false)
    }
  }

  // Shown so the user can paste it into the selected provider's dashboard.
  // Only meaningful once the agent has actually been saved with WhatsApp
  // enabled (before that, there's no webhookSecret yet).
  const whatsappWebhookUrl = createMemo(() => {
    const secret = form.whatsappWebhookSecret
    if (!secret) return undefined
    const base = (publicTunnelUrl() ?? serverSDK().url).replace(/\/$/, "")
    return `${base}/whatsapp/webhook/${form.id}/${secret}?directory=${encodeURIComponent(directory() ?? "")}`
  })

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3">
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="arrow-left" />}
          aria-label={language.t("common.goBack")}
          onClick={() => navigate("/agentui")}
        />
        <span class="flex-1 text-13-medium text-v2-text-text-base">{title()}</span>
        <TooltipV2
          placement="bottom"
          value={everSaved() ? language.t("settings.agentui.sandbox.open") : language.t("settings.agentui.form.testHint")}
        >
          <ButtonV2 variant="neutral" disabled={!everSaved()} onClick={openSandbox}>
            {language.t("settings.agentui.sandbox.open")}
          </ButtonV2>
        </TooltipV2>
        <ButtonV2 variant="contrast" disabled={saving()} onClick={() => void save()}>
          {saving() ? language.t("common.saving") : language.t("common.save")}
        </ButtonV2>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="close" />}
          aria-label={language.t("common.close")}
          onClick={() => navigate("/agentui")}
        />
      </div>

      <Show when={ready()} fallback={<div class="flex-1" />}>
        <div class="flex min-h-0 flex-1">
          <ScrollView class="min-h-0 flex-1">
            <div class="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-3 py-8 lg:px-6">
              <div class="flex w-full min-w-0 flex-col gap-2 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-raised p-3">
                <button
                  type="button"
                  class="flex items-center gap-2 text-13-medium text-v2-text-text-base"
                  onClick={() => setAiOpen((open) => !open)}
                >
                  <Icon name="brain" />
                  {language.t("settings.agentui.ai.title")}
                  <IconV2 name={aiOpen() ? "chevron-up" : "chevron-down"} class="ml-auto" />
                </button>
                <Show when={aiOpen()}>
                  <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.ai.hint")}</p>
                  <TextareaV2
                    class="!w-full self-stretch"
                    rows={3}
                    value={aiDescription()}
                    placeholder={language.t("settings.agentui.ai.placeholder")}
                    onInput={(event) => setAiDescription(event.currentTarget.value)}
                  />
                  <Show when={aiError()}>
                    <span class="settings-v2-server-dialog-error">{aiError()}</span>
                  </Show>
                  <ButtonV2
                    variant="outline"
                    disabled={aiGenerating() || !aiDescription().trim()}
                    onClick={() => void generateWithAI()}
                  >
                    {aiGenerating() ? language.t("settings.agentui.ai.generating") : language.t("settings.agentui.ai.generate")}
                  </ButtonV2>
                </Show>
              </div>

              <div class="flex w-full min-w-0 flex-col gap-2">
                <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.name")}</label>
                <TextInputV2
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={form.name}
                  autofocus={!isEdit}
                  onInput={(event) => setForm("name", event.currentTarget.value)}
                />
              </div>

              <div class="flex w-full min-w-0 flex-col gap-2">
                <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.personality")}</label>
                <TextareaV2
                  class="!w-full self-stretch"
                  rows={16}
                  value={form.personality}
                  onInput={(event) => setForm("personality", event.currentTarget.value)}
                />
              </div>

              <Show when={error()}>
                <span class="settings-v2-server-dialog-error">{error()}</span>
              </Show>
            </div>
          </ScrollView>

          <div class="flex min-h-0 w-[420px] shrink-0 flex-col border-l border-v2-border-border-base">
            <TabsV2 defaultValue="general" class="flex min-h-0 flex-1 flex-col">
              <TabsV2.List>
                <TabsV2.Trigger value="general">{language.t("settings.agentui.tabs.general")}</TabsV2.Trigger>
                <TabsV2.Trigger value="channels">{language.t("settings.agentui.tabs.channels")}</TabsV2.Trigger>
                <TabsV2.Trigger value="tools">{language.t("settings.agentui.tabs.tools")}</TabsV2.Trigger>
                <TabsV2.Trigger value="knowledge">{language.t("settings.agentui.tabs.knowledge")}</TabsV2.Trigger>
              </TabsV2.List>

              <ScrollView class="min-h-0 flex-1">
                <TabsV2.Content value="general">
                  <div class="flex w-full flex-col gap-5 px-4 py-6">
                    <div class="flex items-center justify-between">
                      <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.enabled")}</label>
                      <Switch checked={form.enabled} onChange={(checked) => setForm("enabled", checked)} />
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.model")}</label>
                      <ModelPickerV2 value={form.model} onChange={(value) => setForm("model", value)} combos={combos() ?? []} />
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.commandTriggers")}</label>
                      <TextInputV2
                        value={form.commandTriggers}
                        onInput={(event) => setForm("commandTriggers", event.currentTarget.value)}
                        placeholder="! #"
                      />
                    </div>

                    <div class="flex items-center justify-between">
                      <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.guardrails")}</label>
                      <Switch checked={form.guardrailsEnabled} onChange={(checked) => setForm("guardrailsEnabled", checked)} />
                    </div>
                    <Show when={form.guardrailsEnabled}>
                      <div class="flex flex-col gap-1.5">
                        <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.guardrailsLevel")}</label>
                        <select
                          class="h-8 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 text-13-regular"
                          value={form.guardrailsLevel}
                          onChange={(event) => setForm("guardrailsLevel", event.currentTarget.value as "basic" | "strict")}
                        >
                          <option value="basic">{language.t("settings.agentui.guardrails.basic")}</option>
                          <option value="strict">{language.t("settings.agentui.guardrails.strict")}</option>
                        </select>
                      </div>
                    </Show>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="channels">
                  <div class="flex w-full flex-col gap-5 px-4 py-6">
                    <div class="flex flex-col gap-1.5">
                      <div class="flex items-center justify-between">
                        <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.telegram")}</label>
                        <Switch checked={form.telegram} onChange={(checked) => setForm("telegram", checked)} />
                      </div>
                      <Show when={form.telegram}>
                        <TextInputV2
                          value={form.telegramToken}
                          onInput={(event) => setForm("telegramToken", event.currentTarget.value)}
                          placeholder={language.t("settings.agentui.field.telegramToken.placeholder")}
                        />
                        <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.field.telegramToken.hint")}</p>
                      </Show>
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <div class="flex items-center justify-between">
                        <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.whatsapp")}</label>
                        <Switch checked={form.whatsapp} onChange={(checked) => setForm("whatsapp", checked)} />
                      </div>
                      <Show when={form.whatsapp}>
                        <select
                          class="h-8 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 text-13-regular"
                          value={form.whatsappProvider}
                          onChange={(event) => {
                            setForm({
                              whatsappProvider: event.currentTarget.value as WhatsAppProvider,
                              whatsappConfig: {},
                              whatsappSessionIds: [],
                              whatsappAllowedGroups: [],
                            })
                            setIzapiaSessions([])
                            setIzapiaSessionsError(undefined)
                            setIzapiaGroups([])
                            setIzapiaGroupsError(undefined)
                          }}
                        >
                          <For each={Object.entries(WHATSAPP_PROVIDER_LABELS)}>
                            {([value, label]) => <option value={value}>{label}</option>}
                          </For>
                        </select>
                        <Show when={WHATSAPP_PROVIDER_LINKS[form.whatsappProvider]}>
                          {(url) => (
                            <a
                              href={url()}
                              target="_blank"
                              rel="noreferrer"
                              class="text-11-regular text-v2-text-text-accent underline"
                            >
                              {language.t("settings.agentui.field.whatsapp.providerLink", {
                                provider: WHATSAPP_PROVIDER_LABELS[form.whatsappProvider],
                              })}
                            </a>
                          )}
                        </Show>
                        <For each={WHATSAPP_PROVIDER_FIELDS[form.whatsappProvider]}>
                          {(field) => (
                            <TextInputV2
                              value={form.whatsappConfig[field.key] ?? ""}
                              onInput={(event) =>
                                setForm("whatsappConfig", (cfg) => ({ ...cfg, [field.key]: event.currentTarget.value }))
                              }
                              placeholder={field.label + (field.required ? "" : ` (${language.t("common.optional")})`)}
                            />
                          )}
                        </For>
                        <Show when={form.whatsappProvider === "izapia"}>
                          <label class="settings-v2-server-dialog-label">
                            {language.t("settings.agentui.field.whatsapp.izapiaSessions.label")}
                          </label>
                          <ButtonV2
                            variant="outline"
                            disabled={!form.whatsappConfig.apiKey?.trim() || izapiaSessionsLoading()}
                            onClick={() => void fetchIzapiaSessions()}
                          >
                            {izapiaSessionsLoading()
                              ? language.t("settings.agentui.field.whatsapp.izapiaSessions.loading")
                              : language.t("settings.agentui.field.whatsapp.izapiaSessions.fetch")}
                          </ButtonV2>
                          <Show when={izapiaSessionsError()}>
                            <span class="settings-v2-server-dialog-error">{izapiaSessionsError()}</span>
                          </Show>
                          <Show when={izapiaSessions().length > 0}>
                            <div class="flex flex-col gap-1">
                              <For each={izapiaSessions()}>
                                {(session) => (
                                  <label
                                    class={`
                                      flex cursor-pointer items-center justify-between gap-2 rounded-md border
                                      px-2.5 py-1.5 text-13-regular
                                      ${
                                        form.whatsappSessionIds.includes(session.id)
                                          ? "border-v2-border-border-focus bg-v2-background-bg-layer-01"
                                          : "border-v2-border-border-base bg-v2-background-bg-base hover:bg-v2-background-bg-layer-01"
                                      }
                                    `}
                                  >
                                    <span class="flex min-w-0 items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={form.whatsappSessionIds.includes(session.id)}
                                        onChange={(event) => toggleIzapiaSession(session.id, event.currentTarget.checked)}
                                      />
                                      <span class="truncate text-v2-text-text-base">
                                        {session.name || session.jid || session.id}
                                      </span>
                                    </span>
                                    <span class="shrink-0 text-11-regular text-v2-text-text-faint">{session.status}</span>
                                  </label>
                                )}
                              </For>
                            </div>
                          </Show>

                          <label class="settings-v2-server-dialog-label">
                            {language.t("settings.agentui.field.whatsapp.izapiaGroups.label")}
                          </label>
                          <p class="text-11-regular text-v2-text-text-faint">
                            {language.t("settings.agentui.field.whatsapp.izapiaGroups.hint")}
                          </p>
                          <ButtonV2
                            variant="outline"
                            disabled={form.whatsappSessionIds.length === 0 || izapiaGroupsLoading()}
                            onClick={() => void fetchIzapiaGroups()}
                          >
                            {izapiaGroupsLoading()
                              ? language.t("settings.agentui.field.whatsapp.izapiaGroups.loading")
                              : language.t("settings.agentui.field.whatsapp.izapiaGroups.fetch")}
                          </ButtonV2>
                          <Show when={izapiaGroupsError()}>
                            <span class="settings-v2-server-dialog-error">{izapiaGroupsError()}</span>
                          </Show>
                          <Show when={izapiaGroups().length > 0}>
                            <div class="flex flex-col gap-1">
                              <For each={izapiaGroups()}>
                                {(group) => (
                                  <label
                                    class={`
                                      flex cursor-pointer items-center justify-between gap-2 rounded-md border
                                      px-2.5 py-1.5 text-13-regular
                                      ${
                                        form.whatsappAllowedGroups.includes(group.id)
                                          ? "border-v2-border-border-focus bg-v2-background-bg-layer-01"
                                          : "border-v2-border-border-base bg-v2-background-bg-base hover:bg-v2-background-bg-layer-01"
                                      }
                                    `}
                                  >
                                    <span class="flex min-w-0 items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={form.whatsappAllowedGroups.includes(group.id)}
                                        onChange={(event) => toggleIzapiaGroup(group.id, event.currentTarget.checked)}
                                      />
                                      <span class="truncate text-v2-text-text-base">{group.subject}</span>
                                    </span>
                                    <span class="shrink-0 text-11-regular text-v2-text-text-faint">
                                      {group.participantCount}
                                    </span>
                                  </label>
                                )}
                              </For>
                            </div>
                          </Show>
                        </Show>
                        <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.field.whatsapp.hint")}</p>
                        <Show when={isPrivateServerUrl() && !publicTunnelUrl()}>
                          <div class="flex flex-col gap-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2.5">
                            <p class="text-11-regular text-v2-text-text-faint">
                              {language.t("settings.agentui.field.whatsapp.tunnel.hint")}
                            </p>
                            <ButtonV2 variant="outline" disabled={tunnelStarting()} onClick={() => void startPublicTunnel()}>
                              {tunnelStarting()
                                ? language.t("settings.agentui.field.whatsapp.tunnel.starting")
                                : language.t("settings.agentui.field.whatsapp.tunnel.start")}
                            </ButtonV2>
                            <Show when={tunnelError()}>
                              <span class="settings-v2-server-dialog-error">{tunnelError()}</span>
                            </Show>
                          </div>
                        </Show>
                        <Show when={publicTunnelUrl()}>
                          <p class="text-11-regular text-v2-text-text-accent">
                            {language.t("settings.agentui.field.whatsapp.tunnel.active", { url: publicTunnelUrl()! })}
                          </p>
                        </Show>
                        <Show
                          when={whatsappWebhookUrl()}
                          fallback={
                            <p class="text-11-regular text-v2-text-text-faint">
                              {language.t("settings.agentui.field.whatsapp.webhookAfterSave")}
                            </p>
                          }
                        >
                          {(url) => (
                            <div class="flex flex-col gap-1">
                              <label class="settings-v2-server-dialog-label">
                                {language.t("settings.agentui.field.whatsapp.webhookUrl")}
                              </label>
                              <TextInputV2 value={url()} readOnly />
                            </div>
                          )}
                        </Show>
                      </Show>
                    </div>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="tools">
                  <div class="flex w-full flex-col gap-3 px-4 py-6">
                    <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.mcpServers")}</label>
                    <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.field.mcpServers.hint")}</p>
                    <Show
                      when={!mcpServers.loading}
                      fallback={<p class="text-11-regular text-v2-text-text-faint">{language.t("common.loading")}</p>}
                    >
                      <Show
                        when={(mcpServers() ?? []).length > 0}
                        fallback={
                          <p class="text-11-regular text-v2-text-text-faint">
                            {directory()
                              ? language.t("settings.agentui.field.mcpServers.empty")
                              : language.t("settings.agentui.field.mcpServers.noDirectory")}
                          </p>
                        }
                      >
                        <For each={mcpServers()}>
                          {(name) => (
                            <div class="flex items-center justify-between">
                              <span class="text-13-regular text-v2-text-text-base">{name}</span>
                              <Switch
                                checked={form.mcpServers.includes(name)}
                                onChange={(checked) => toggleMcpServer(name, checked)}
                              />
                            </div>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="knowledge">
                  <div class="flex w-full flex-col gap-5 px-4 py-6">
                    <div class="flex flex-col gap-2">
                      <label class="settings-v2-server-dialog-label">{language.t("settings.agentui.field.ragSources")}</label>
                      <For each={form.ragSources}>
                        {(source, index) => (
                          <div class="flex items-start gap-2">
                            <TextInputV2
                              class="w-[100px]"
                              placeholder={language.t("settings.agentui.rag.label")}
                              value={source.label}
                              onInput={(event) => setForm("ragSources", index(), "label", event.currentTarget.value)}
                            />
                            <TextInputV2
                              class="flex-1"
                              placeholder={language.t("settings.agentui.rag.value")}
                              value={source.value}
                              onInput={(event) => setForm("ragSources", index(), "value", event.currentTarget.value)}
                            />
                            <IconButtonV2
                              type="button"
                              variant="ghost-muted"
                              size="small"
                              icon={<IconV2 name="xmark-small" />}
                              aria-label={language.t("common.remove")}
                              onClick={() => removeRagSource(source.id)}
                            />
                          </div>
                        )}
                      </For>
                      <ButtonV2 variant="outline" onClick={addRagSource}>
                        {language.t("settings.agentui.rag.add")}
                      </ButtonV2>
                      <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.agentui.rag.note")}</p>
                    </div>
                  </div>
                </TabsV2.Content>

              </ScrollView>
            </TabsV2>
          </div>
        </div>
      </Show>
    </div>
  )
}
