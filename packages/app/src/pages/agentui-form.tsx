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
import { formatServerError } from "@/utils/server-errors"
import { GlobalLoading } from "@/components/global-loading"
import { ModelPickerV2 } from "@/components/model-picker-v2"
import { DialogAgentUISandbox } from "@/components/settings-v2/dialog-agentui-sandbox"
import { DialogAgentUIDiagnose } from "@/components/settings-v2/dialog-agentui-diagnose"
import { DialogIzapiaGroupParticipants } from "@/components/settings-v2/dialog-izapia-group-participants"
import {
  WHATSAPP_PROVIDER_FIELDS,
  WHATSAPP_PROVIDER_LABELS,
  WHATSAPP_PROVIDER_LINKS,
  type WhatsAppProvider,
} from "@/components/settings-v2/whatsapp-providers"
import "@/components/settings-v2/settings-v2.css"

// Module-level (not component state) so it survives remounting the form —
// reopening "Editar agente" for the same izapia agent used to re-hit
// whatsapp.izapiaSessions/izapiaGroups every single time via the auto-load
// effect below. Each visit is a handful of HTTP calls against izapia's own
// account-wide rate limit; enough repeat visits during a session exhausted
// that budget and made the *actual* reply-send fail too (see whatsapp/
// index.ts's sendText retry). Caching by apiKey (and by apiKey+session set
// for groups) means only the first visit per key pays that cost.
const izapiaSessionsCache = new Map<string, { id: string; name?: string; status: string; jid?: string }[]>()
const izapiaGroupsCache = new Map<string, { id: string; subject: string; sessionId: string; participantCount: number }[]>()
const papiInstancesCache = new Map<string, { id: string; name?: string; status: string; jid?: string }[]>()
const papiGroupsCache = new Map<string, { id: string; subject: string; sessionId: string; participantCount: number }[]>()

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
  whatsappAllowedSenders: string
  whatsappGroupAllowedSenders: Record<string, string[]>
  whatsappMentionOnly: boolean
  whatsappPublicUrl?: string
  whatsappDirectory?: string
  whatsappWebhookSecret: string
  mcpServers: string[]
  routinesEnabled: boolean
  agendaEnabled: boolean
  memoryEnabled: boolean
  filesystemEnabled: boolean
  terminalEnabled: boolean
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
    whatsappProvider: "papi",
    whatsappConfig: {},
    whatsappSessionIds: [],
    whatsappAllowedGroups: [],
    whatsappAllowedSenders: "",
    whatsappGroupAllowedSenders: {},
    whatsappMentionOnly: false,
    whatsappPublicUrl: undefined,
    whatsappDirectory: undefined,
    whatsappWebhookSecret: "",
    mcpServers: [],
    routinesEnabled: false,
    agendaEnabled: true,
    memoryEnabled: true,
    filesystemEnabled: false,
    terminalEnabled: false,
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
      ragSources: (agent.ragSources ?? []).filter(Boolean).map((s) => ({ id: s.id, kind: (s.kind as "text" | "url") || "text", label: s.label || "", value: s.value || "" })),
      guardrailsEnabled: agent.guardrails.enabled,
      guardrailsLevel: agent.guardrails.level,
      telegram: agent.channels.some((c) => c.type === "telegram"),
      telegramToken: agent.channels.find((c) => c.type === "telegram")?.token ?? "",
      whatsapp: agent.channels.some((c) => c.type === "whatsapp"),
      whatsappProvider: (agent.channels.find((c) => c.type === "whatsapp")?.provider as WhatsAppProvider) ?? "papi",
      whatsappConfig: agent.channels.find((c) => c.type === "whatsapp")?.config ?? {},
      whatsappSessionIds: [...(agent.channels.find((c) => c.type === "whatsapp")?.sessionIds ?? [])],
      whatsappAllowedGroups: [...(agent.channels.find((c) => c.type === "whatsapp")?.allowedGroups ?? [])],
      whatsappAllowedSenders: (agent.channels.find((c) => c.type === "whatsapp")?.allowedSenders ?? []).join(", "),
      whatsappGroupAllowedSenders: (agent.channels.find((c) => c.type === "whatsapp") as any)?.groupAllowedSenders ?? {},
      whatsappMentionOnly: (agent.channels.find((c) => c.type === "whatsapp") as any)?.mentionOnly === true,
      whatsappPublicUrl: (agent.channels.find((c) => c.type === "whatsapp") as any)?.publicUrl,
      whatsappDirectory: agent.channels.find((c) => c.type === "whatsapp")?.directory,
      whatsappWebhookSecret: agent.channels.find((c) => c.type === "whatsapp")?.webhookSecret ?? "",
      mcpServers: agent.mcpServers ?? [],
      routinesEnabled: agent.routinesEnabled === true,
      agendaEnabled: (agent as any).agendaEnabled ?? true,
      memoryEnabled: (agent as any).memoryEnabled ?? true,
      filesystemEnabled: (agent as any).filesystemEnabled === true,
      terminalEnabled: (agent as any).terminalEnabled === true,
      enabled: agent.enabled !== false,
    })
  })

  // Auto-load the izapia session/group pickers on edit — without this, the
  // lists start empty (see izapiaSessions/izapiaGroups below) even though
  // form.whatsappSessionIds/whatsappAllowedGroups already hold the saved
  // selection, so reopening an agent for editing looked like every
  // session/group checkbox had to be picked again from scratch.
  createEffect(() => {
    const agent = existing()
    if (!agent || !isEdit) return
    const channel = agent.channels.find((c) => c.type === "whatsapp")
    if (channel?.type !== "whatsapp") return
    if (channel.provider === "papi") {
      const token = channel.config.token?.trim()
      if (!token) return
      void fetchPapiInstances().then(() => {
        if (form.whatsappSessionIds.length > 0) void fetchPapiGroups()
      })
    } else if (channel.provider === "izapia") {
      const apiKey = channel.config.apiKey?.trim()
      if (!apiKey) return
      void fetchIzapiaSessions().then(() => {
        if (form.whatsappSessionIds.length > 0) void fetchIzapiaGroups()
      })
    }
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

  const fetchIzapiaSessions = async (options?: { force?: boolean }) => {
    const apiKey = form.whatsappConfig.apiKey?.trim()
    if (!apiKey || izapiaSessionsLoading()) return
    if (!options?.force) {
      const cached = izapiaSessionsCache.get(apiKey)
      if (cached) {
        setIzapiaSessions(cached)
        return
      }
    }
    setIzapiaSessionsError(undefined)
    setIzapiaSessionsLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.izapiaSessions({ apiKey })
      izapiaSessionsCache.set(apiKey, result.data ?? [])
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

  const fetchIzapiaGroups = async (options?: { force?: boolean }) => {
    const apiKey = form.whatsappConfig.apiKey?.trim()
    if (!apiKey || form.whatsappSessionIds.length === 0 || izapiaGroupsLoading()) return
    const cacheKey = `${apiKey}:${[...form.whatsappSessionIds].sort().join(",")}`
    if (!options?.force) {
      const cached = izapiaGroupsCache.get(cacheKey)
      if (cached) {
        setIzapiaGroups(cached)
        return
      }
    }
    setIzapiaGroupsError(undefined)
    setIzapiaGroupsLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.izapiaGroups({ apiKey, sids: form.whatsappSessionIds })
      const groups = (result.data ?? []).map((group) => ({ ...group, participantCount: Number(group.participantCount) }))
      izapiaGroupsCache.set(cacheKey, groups)
      setIzapiaGroups(groups)
      if (!result.data?.length) setIzapiaGroupsError(language.t("settings.agentui.field.whatsapp.izapiaGroups.empty"))
    } catch (cause) {
      setIzapiaGroupsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIzapiaGroupsLoading(false)
    }
  }

  const toggleIzapiaGroup = (id: string, checked: boolean) =>
    setForm("whatsappAllowedGroups", (list) => (checked ? [...list, id] : list.filter((item) => item !== id)))

  const [papiInstances, setPapiInstances] = createSignal<
    { id: string; name?: string; status: string; jid?: string }[]
  >([])
  const [papiInstancesLoading, setPapiInstancesLoading] = createSignal(false)
  const [papiInstancesError, setPapiInstancesError] = createSignal<string | undefined>()

  const [papiGroups, setPapiGroups] = createSignal<
    { id: string; subject: string; sessionId: string; participantCount: number }[]
  >([])
  const [papiGroupsLoading, setPapiGroupsLoading] = createSignal(false)
  const [papiGroupsError, setPapiGroupsError] = createSignal<string | undefined>()

  const [papiWebhookConfiguring, setPapiWebhookConfiguring] = createSignal(false)
  const [papiWebhookSuccess, setPapiWebhookSuccess] = createSignal<string | undefined>()
  const [papiWebhookError, setPapiWebhookError] = createSignal<string | undefined>()

  const [papiCreatingInstance, setPapiCreatingInstance] = createSignal(false)
  const [papiNewInstanceName, setPapiNewInstanceName] = createSignal("")
  const [papiCreateError, setPapiCreateError] = createSignal<string | undefined>()

  const fetchPapiInstances = async (options?: { force?: boolean }) => {
    const token = form.whatsappConfig.token?.trim()
    if (!token || papiInstancesLoading()) return
    if (!options?.force) {
      const cached = papiInstancesCache.get(token)
      if (cached) {
        setPapiInstances(cached)
        return
      }
    }
    setPapiInstancesError(undefined)
    setPapiInstancesLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.papiInstances({ token })
      papiInstancesCache.set(token, result.data ?? [])
      setPapiInstances(result.data ?? [])
      if (!result.data?.length) setPapiInstancesError("Nenhuma instância encontrada para este token na Papi Cloud.")
    } catch (cause) {
      setPapiInstancesError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPapiInstancesLoading(false)
    }
  }

  const togglePapiInstance = (id: string, checked: boolean) => {
    setForm("whatsappSessionIds", (list) => (checked ? [...list, id] : list.filter((item) => item !== id)))
    setPapiGroups([])
    setPapiGroupsError(undefined)
    setForm("whatsappAllowedGroups", [])
  }

  const fetchPapiGroups = async (options?: { force?: boolean }) => {
    const token = form.whatsappConfig.token?.trim()
    if (!token || form.whatsappSessionIds.length === 0 || papiGroupsLoading()) return
    const cacheKey = `${token}:${[...form.whatsappSessionIds].sort().join(",")}`
    if (!options?.force) {
      const cached = papiGroupsCache.get(cacheKey)
      if (cached) {
        setPapiGroups(cached)
        return
      }
    }
    setPapiGroupsError(undefined)
    setPapiGroupsLoading(true)
    try {
      const result = await serverSDK().client.whatsapp.papiGroups({ token, instanceIds: form.whatsappSessionIds })
      const groups = (result.data ?? []).map((group) => ({ ...group, participantCount: Number(group.participantCount) }))
      papiGroupsCache.set(cacheKey, groups)
      setPapiGroups(groups)
      if (!result.data?.length) setPapiGroupsError("Nenhum grupo encontrado nas instâncias selecionadas.")
    } catch (cause) {
      setPapiGroupsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPapiGroupsLoading(false)
    }
  }

  const configurePapiWebhook = async (instanceId: string) => {
    const token = form.whatsappConfig.token?.trim()
    if (!token || !instanceId || papiWebhookConfiguring()) return
    let secret = form.whatsappWebhookSecret
    if (!secret) {
      secret = crypto.randomUUID()
      setForm("whatsappWebhookSecret", secret)
    }
    const base = (publicTunnelUrl() ?? form.whatsappPublicUrl ?? serverSDK().url).replace(/\/$/, "")
    const dir = form.whatsappDirectory ? `?directory=${encodeURIComponent(form.whatsappDirectory)}` : ""
    const url = `${base}/whatsapp/webhook/${form.id}/${secret}${dir}`
    setPapiWebhookConfiguring(true)
    setPapiWebhookError(undefined)
    setPapiWebhookSuccess(undefined)
    try {
      await serverSDK().client.whatsapp.papiSetupWebhook({
        token,
        instanceId,
        webhookUrl: url,
      })
      setPapiWebhookSuccess(`Webhook configurado com sucesso na Papi Cloud (${instanceId})!`)
    } catch (cause) {
      setPapiWebhookError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPapiWebhookConfiguring(false)
    }
  }

  const createPapiInstance = async () => {
    const token = form.whatsappConfig.token?.trim()
    const name = papiNewInstanceName().trim()
    if (!token || !name || papiCreatingInstance()) return
    setPapiCreatingInstance(true)
    setPapiCreateError(undefined)
    try {
      const res = await serverSDK().client.whatsapp.papiCreateInstance({ token, instanceName: name })
      setPapiNewInstanceName("")
      await fetchPapiInstances({ force: true })
      if (res.data?.id) {
        setForm("whatsappSessionIds", (list) => [...list, res.data.id])
      }
    } catch (cause) {
      setPapiCreateError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPapiCreatingInstance(false)
    }
  }

  // Audit log: one row per real turn (incoming message + the agent's
  // reply), across every channel — see AgentUI.Service.logAudit. A dedicated
  // full-page view (AgentUIAuditPage, /agentui/:id/audit), not a tab here —
  // an agent can have hundreds of distinct conversations, which needs a
  // contact-list-then-thread layout this narrow sidebar tab isn't built for.

  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const [filterAudioOnly, setFilterAudioOnly] = createSignal(false)
  const [activeTab, setActiveTab] = createSignal<string>("general")
  const [manualGroupId, setManualGroupId] = createSignal("")

  const addManualGroup = () => {
    const raw = manualGroupId().trim()
    if (!raw) return
    const id = raw.includes("@") ? raw : `${raw}@g.us`
    if (!form.whatsappAllowedGroups.includes(id)) {
      setForm("whatsappAllowedGroups", (list) => [...list, id])
    }
    setManualGroupId("")
  }

  const removeGroup = (groupId: string) => {
    setForm("whatsappAllowedGroups", (list) => list.filter((id) => id !== groupId))
  }

  // "Criar com IA": one-shot generation, not a conversation — the user
  // describes the agent once, the draft lands in the form fields below for
  // review/editing, same as if they'd typed it by hand. Open by default
  // only for a brand-new agent; editing an existing one hides it until
  // asked for, so it can't be mistaken for "regenerate this agent".
  const [aiOpen, setAiOpen] = createSignal(!isEdit)
  const [aiDescription, setAiDescription] = createSignal("")
  const [aiModel, setAiModel] = createSignal("")
  const [aiGenerating, setAiGenerating] = createSignal(false)
  const [aiError, setAiError] = createSignal<string | undefined>()

  const generateWithAI = async () => {
    if (!aiDescription().trim() || aiGenerating()) return
    setAiError(undefined)
    setAiGenerating(true)
    try {
      const selectedModel = aiModel().trim() || form.model.trim() || undefined
      const result = await serverSDK().client.agentui.generate({
        description: aiDescription(),
        model: selectedModel,
      } as any)
      const draft = result.data
      if (!draft) throw new Error(language.t("common.requestFailed"))
      setForm("name", draft.name)
      setForm("personality", draft.personality)
      setForm("commandTriggers", draft.commandTriggers.join(" "))
      setForm("guardrailsEnabled", draft.guardrails.enabled)
      setForm("guardrailsLevel", draft.guardrails.level as "basic" | "strict")
      if (selectedModel) {
        setForm("model", selectedModel)
      } else if (!form.model && (draft as any).model) {
        setForm("model", (draft as any).model)
      }
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.agentui.ai.toast.generated") })
      setAiOpen(false)
    } catch (cause: any) {
      const reason =
        cause?.cause?.body?.reason ||
        cause?.cause?.body?.message ||
        cause?.data?.reason ||
        cause?.response?.data?.reason ||
        cause?.error?.reason ||
        cause?.message ||
        String(cause)
      setAiError(reason)
    } finally {
      setAiGenerating(false)
    }
  }

  const save = async () => {
    if (!form.name.trim()) {
      setActiveTab("general")
      const msg = "Dê um nome ao agente na aba Geral antes de salvar."
      setError(msg)
      showToast({
        variant: "error",
        title: "Nome do agente obrigatório",
        description: msg,
      })
      return
    }
    if (!form.model) {
      setActiveTab("general")
      const msg = "Selecione o Modelo de IA na aba Geral antes de salvar."
      setError(msg)
      showToast({
        variant: "error",
        title: "Modelo de IA obrigatório",
        description: msg,
      })
      return
    }
    const ownBotToken = form.telegram ? form.telegramToken.trim() : ""
    if (form.whatsapp) {
      const whatsappFields = WHATSAPP_PROVIDER_FIELDS[form.whatsappProvider]
      const missingField = whatsappFields.find((f) => f.required && !form.whatsappConfig[f.key]?.trim())
      if (missingField) {
        setActiveTab("channels")
        const msg = `Preencha o campo obrigatório "${missingField.label}" nas configurações do WhatsApp.`
        setError(msg)
        showToast({
          variant: "error",
          title: "Campo obrigatório do WhatsApp",
          description: msg,
        })
        return
      }

      if (form.whatsappProvider === "papi") {
        const manualInstance = form.whatsappConfig.instanceId?.trim()
        if (manualInstance && !form.whatsappSessionIds.includes(manualInstance)) {
          setForm("whatsappSessionIds", (list) => [...list, manualInstance])
        }
      }

      const whatsappMissingSession =
        (form.whatsappProvider === "izapia" || form.whatsappProvider === "papi") &&
        form.whatsappSessionIds.length === 0 &&
        !form.whatsappConfig.instanceId?.trim()

      if (whatsappMissingSession) {
        setActiveTab("channels")
        const msg =
          form.whatsappProvider === "papi"
            ? "Selecione ou crie pelo menos uma instância da Papi Cloud para o agente escutar."
            : "Selecione pelo menos uma sessão do WhatsApp para o agente escutar."
        setError(msg)
        showToast({
          variant: "error",
          title: "Instância do WhatsApp necessária",
          description: msg,
        })
        return
      }
    }
    setError(undefined)
    setSaving(true)
    const triggers = form.commandTriggers
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    const senders = form.whatsappAllowedSenders
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const channels: Array<
      | { type: "telegram"; token?: string; directory?: string }
      | {
          type: "whatsapp"
          provider: WhatsAppProvider
          config: Record<string, string>
          sessionIds?: string[]
          allowedGroups?: string[]
          allowedSenders?: string[]
          groupAllowedSenders?: Record<string, string[]>
          mentionOnly?: boolean
          publicUrl?: string
          directory?: string
          webhookSecret: string
        }
    > = []
    if (form.telegram) channels.push({ type: "telegram", token: ownBotToken || undefined, directory: form.whatsappDirectory || undefined })
    const whatsappWebhookSecret = form.whatsappWebhookSecret || crypto.randomUUID()
    if (form.whatsapp) {
      channels.push({
        type: "whatsapp",
        provider: form.whatsappProvider,
        config: form.whatsappConfig,
        sessionIds:
          form.whatsappProvider === "izapia" || form.whatsappProvider === "papi"
            ? form.whatsappSessionIds
            : undefined,
        allowedGroups:
          form.whatsappProvider === "izapia" || form.whatsappProvider === "papi"
            ? form.whatsappAllowedGroups
            : undefined,
        allowedSenders: senders.length > 0 ? senders : undefined,
        groupAllowedSenders:
          Object.keys(form.whatsappGroupAllowedSenders).length > 0 ? form.whatsappGroupAllowedSenders : undefined,
        mentionOnly: form.whatsappMentionOnly,
        publicUrl: publicTunnelUrl() ?? form.whatsappPublicUrl ?? undefined,
        directory: form.whatsappDirectory || undefined,
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
          // Only `value` is actually required to be useful (it's the text/URL
          // that gets fetched) — dropping a source just because its `label`
          // was left blank silently threw away real content on save (a
          // pasted URL with no title never made it past this filter, so it
          // looked "saved" in the form but was gone after reloading). A
          // missing label falls back to the value itself instead.
          ragSources: form.ragSources
            .filter((s) => s.value.trim())
            .map((s) => ({ ...s, label: s.label.trim() || s.value.trim() })),
          guardrails: { enabled: form.guardrailsEnabled, level: form.guardrailsLevel },
          mcpServers: form.mcpServers,
          routinesEnabled: form.routinesEnabled,
          agendaEnabled: form.agendaEnabled,
          memoryEnabled: form.memoryEnabled,
          filesystemEnabled: form.filesystemEnabled,
          terminalEnabled: form.terminalEnabled,
          enabled: form.enabled,
        },
      })
      if (form.whatsapp) setForm("whatsappWebhookSecret", whatsappWebhookSecret)
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.agentui.toast.saved") })
      setEverSaved(true)
      if (!isEdit) navigate(`/agentui/${form.id}/edit`, { replace: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: message,
      })
    } finally {
      setSaving(false)
    }
  }

  const openSandbox = () => {
    if (!everSaved()) return
    dialog.push(() => <DialogAgentUISandbox agentID={form.id} agentName={form.name || "—"} directory={directory()} />)
  }

  const openDiagnose = () => {
    if (!everSaved()) return
    dialog.push(() => (
      <DialogAgentUIDiagnose
        agentID={form.id}
        agentName={form.name || "—"}
        directory={directory()}
        onOpenSandbox={openSandbox}
      />
    ))
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
  const [tailscaleDetecting, setTailscaleDetecting] = createSignal(false)
  const [tailscaleError, setTailscaleError] = createSignal<string | undefined>()
  const [funnelStarting, setFunnelStarting] = createSignal(false)
  const [funnelError, setFunnelError] = createSignal<string | undefined>()

  createEffect(() => {
    if (form.whatsappPublicUrl && !publicTunnelUrl()) {
      setPublicTunnelUrl(form.whatsappPublicUrl)
    }
  })

  const useTailscaleIp = async () => {
    if (tailscaleDetecting()) return
    setTailscaleError(undefined)
    setTailscaleDetecting(true)
    try {
      const port = Number(new URL(serverSDK().url).port) || 80
      const result = await serverSDK().client.tunnel.tailscale()
      if (result.data?.available && result.data.ip) {
        setPublicTunnelUrl(`http://${result.data.ip}:${port}`)
      } else {
        setTailscaleError(language.t("settings.agentui.field.whatsapp.tunnel.tailscale.notFound"))
      }
    } catch (cause) {
      setTailscaleError(formatServerError(cause, language.t))
    } finally {
      setTailscaleDetecting(false)
    }
  }

  const useTailscaleFunnel = async () => {
    if (funnelStarting()) return
    setFunnelError(undefined)
    setFunnelStarting(true)
    try {
      const port = Number(new URL(serverSDK().url).port) || 80
      const result = await serverSDK().client.tunnel.startFunnel({ port })
      if (result.data?.url) {
        setPublicTunnelUrl(result.data.url)
      } else {
        setFunnelError(language.t("settings.agentui.field.whatsapp.tunnel.tailscaleFunnel.error"))
      }
    } catch (cause) {
      setFunnelError(formatServerError(cause, language.t))
    } finally {
      setFunnelStarting(false)
    }
  }

  // Shown so the user can paste it into the selected provider's dashboard.
  // Only meaningful once the agent has actually been saved with WhatsApp
  // enabled (before that, there's no webhookSecret yet).
  const whatsappWebhookUrl = createMemo(() => {
    const secret = form.whatsappWebhookSecret
    if (!secret) return undefined
    const base = (publicTunnelUrl() ?? serverSDK().url).replace(/\/$/, "")
    return `${base}/whatsapp/webhook/${form.id}/${secret}`
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
          value={everSaved() ? language.t("settings.agentui.diagnose.action") : language.t("settings.agentui.form.testHint")}
        >
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<Icon name="status-active" />}
            disabled={!everSaved()}
            aria-label={language.t("settings.agentui.diagnose.action")}
            onClick={openDiagnose}
          />
        </TooltipV2>
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

      <Show when={error()}>
        <div class="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2.5 text-13-regular text-red-400 shrink-0">
          <div class="flex items-center gap-2">
            <span class="text-14-medium">⚠️</span>
            <span class="font-medium">{error()}</span>
          </div>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="xmark-small" />}
            aria-label="Fechar erro"
            onClick={() => setError(undefined)}
          />
        </div>
      </Show>

      <Show when={ready()} fallback={<GlobalLoading size="normal" class="flex-1" />}>
        <div class="flex min-h-0 flex-1 flex-col">
          <TabsV2 value={activeTab()} onChange={setActiveTab} class="flex min-h-0 flex-1 flex-col">
            <div class="border-b border-v2-border-border-base bg-v2-background-bg-layer-01/40 px-3">
              <TabsV2.List>
                <TabsV2.Trigger value="general">{language.t("settings.agentui.tabs.general")}</TabsV2.Trigger>
                <TabsV2.Trigger value="personality">{language.t("settings.agentui.tabs.personality")}</TabsV2.Trigger>
                <TabsV2.Trigger value="channels">{language.t("settings.agentui.tabs.channels")}</TabsV2.Trigger>
                <TabsV2.Trigger value="tools">{language.t("settings.agentui.tabs.tools")}</TabsV2.Trigger>
                <TabsV2.Trigger value="knowledge">{language.t("settings.agentui.tabs.knowledge")}</TabsV2.Trigger>
              </TabsV2.List>
            </div>

            <ScrollView class="min-h-0 flex-1">
              <div class="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-8 lg:px-8">
                <TabsV2.Content value="general">
                  <div class="flex w-full flex-col gap-6">
                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                        <span class="text-14-medium text-v2-text-text-base">Identificação &amp; Estado</span>
                      </div>
                      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
                        <div class="flex flex-1 min-w-0 flex-col gap-2">
                          <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.name")}</label>
                          <TextInputV2
                            type="text"
                            appearance="large"
                            class="!w-full self-stretch"
                            value={form.name}
                            autofocus={!isEdit}
                            onInput={(event) => setForm("name", event.currentTarget.value)}
                          />
                        </div>
                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5 lg:w-[320px]">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.enabled")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">Controla se o agente está ativo.</p>
                          </div>
                          <Switch checked={form.enabled} onChange={(checked) => setForm("enabled", checked)} />
                        </div>
                      </div>
                    </div>

                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                        <span class="text-14-medium text-v2-text-text-base">Inteligência Artificial (Modelo LLM)</span>
                      </div>
                      <div class="flex flex-col gap-4">
                        <div class="flex flex-col gap-2">
                          <div class="flex items-center justify-between">
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.model")}</label>
                            <label class="flex items-center gap-1.5 text-11-regular text-v2-text-text-muted cursor-pointer hover:text-v2-text-text-base transition-colors">
                              <input
                                type="checkbox"
                                class="rounded border-v2-border-border-base cursor-pointer"
                                checked={filterAudioOnly()}
                                onChange={(e) => setFilterAudioOnly(e.currentTarget.checked)}
                              />
                              {language.t("settings.agentui.field.filterAudio")}
                            </label>
                          </div>
                          <ModelPickerV2
                            value={form.model}
                            onChange={(value) => setForm("model", value)}
                            directory={directory()}
                            requireAudio={filterAudioOnly()}
                          />
                        </div>

                        <div class="flex flex-col gap-1.5">
                          <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.commandTriggers")}</label>
                          <p class="text-11-regular text-v2-text-text-muted">Símbolos para acionar o bot quando em grupos compartilhados (ex: ! #)</p>
                          <TextInputV2
                            value={form.commandTriggers}
                            onInput={(event) => setForm("commandTriggers", event.currentTarget.value)}
                            placeholder="! #"
                          />
                        </div>
                      </div>
                    </div>

                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                        <span class="text-14-medium text-v2-text-text-base">Guardrails &amp; Segurança</span>
                      </div>
                      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5 flex-1">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.guardrails")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">Proteção contra tentativas de injeção de prompt.</p>
                          </div>
                          <Switch checked={form.guardrailsEnabled} onChange={(checked) => setForm("guardrailsEnabled", checked)} />
                        </div>
                        <Show when={form.guardrailsEnabled}>
                          <div class="flex flex-1 flex-col gap-1.5">
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.guardrailsLevel")}</label>
                            <select
                              class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-13-regular text-v2-text-text-base"
                              value={form.guardrailsLevel}
                              onChange={(event) => setForm("guardrailsLevel", event.currentTarget.value as "basic" | "strict")}
                            >
                              <option value="basic">{language.t("settings.agentui.guardrails.basic")}</option>
                              <option value="strict">{language.t("settings.agentui.guardrails.strict")}</option>
                            </select>
                          </div>
                        </Show>
                      </div>
                    </div>

                    <Show when={error()}>
                      <span class="settings-v2-server-dialog-error">{error()}</span>
                    </Show>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="personality">
                  <div class="flex w-full flex-col gap-6">
                    <div class="flex w-full min-w-0 flex-col gap-3 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-raised p-4">
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
                        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.agentui.ai.hint")}</p>
                        <TextareaV2
                          class="!w-full self-stretch"
                          rows={3}
                          value={aiDescription()}
                          placeholder={language.t("settings.agentui.ai.placeholder")}
                          onInput={(event) => setAiDescription(event.currentTarget.value)}
                        />
                        <div class="flex flex-col gap-1.5">
                          <div class="flex items-center justify-between">
                            <label class="settings-v2-server-dialog-label font-medium text-11-medium">
                              {language.t("settings.agentui.field.model")} para geração:
                            </label>
                            <Show when={aiModel()}>
                              <button
                                type="button"
                                class="text-11-regular text-v2-text-text-muted hover:text-v2-text-text-base underline"
                                onClick={() => setAiModel("")}
                              >
                                Usar padrão do sistema / combo
                              </button>
                            </Show>
                          </div>
                          <ModelPickerV2
                            value={aiModel()}
                            onChange={(value) => setAiModel(value)}
                            directory={directory()}
                          />
                          <Show when={!aiModel()}>
                            <p class="text-11-regular text-v2-text-text-muted">
                              Nenhum modelo específico selecionado. Usando:{" "}
                              <span class="font-medium text-v2-text-text-base">
                                {form.model ? form.model : "Padrão do sistema / Combo"}
                              </span>
                            </p>
                          </Show>
                        </div>
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

                    <div class="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                        <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.personality")}</label>
                        <span class="text-11-regular text-v2-text-text-muted">Modo Markdown</span>
                      </div>
                      <p class="text-11-regular text-v2-text-text-muted">
                        Defina o papel, comportamento, tom de voz e diretrizes de como o agente deve responder aos contatos.
                      </p>
                      <TextareaV2
                        class="!w-full self-stretch font-mono text-13-regular"
                        rows={18}
                        value={form.personality}
                        onInput={(event) => setForm("personality", event.currentTarget.value)}
                      />
                    </div>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="channels">
                  <div class="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
                    <div class="flex flex-1 flex-col gap-6 min-w-0">
                      <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                        <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                          <div class="flex items-center gap-2">
                            <span class="size-2 rounded-full bg-emerald-500" />
                            <span class="text-14-medium text-v2-text-text-base">{language.t("settings.agentui.field.whatsapp")}</span>
                          </div>
                          <Switch checked={form.whatsapp} onChange={(checked) => setForm("whatsapp", checked)} />
                        </div>
                        <Show when={form.whatsapp}>
                          <div class="flex flex-col gap-4">
                            <div class="flex flex-col gap-1.5">
                              <label class="settings-v2-server-dialog-label font-medium">Provedor da API</label>
                              <select
                                class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-13-regular text-v2-text-text-base"
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
                                  setPapiInstances([])
                                  setPapiInstancesError(undefined)
                                  setPapiGroups([])
                                  setPapiGroupsError(undefined)
                                  setPapiWebhookSuccess(undefined)
                                  setPapiWebhookError(undefined)
                                }}
                              >
                                <For each={Object.entries(WHATSAPP_PROVIDER_LABELS)}>
                                  {([value, label]) => <option value={value}>{label}</option>}
                                </For>
                              </select>
                            </div>
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
                                <div class="flex flex-col gap-1.5">
                                  <label class="settings-v2-server-dialog-label font-medium">{field.label}</label>
                                  <TextInputV2
                                    value={form.whatsappConfig[field.key] ?? ""}
                                    onInput={(event) =>
                                      setForm("whatsappConfig", (cfg) => ({ ...cfg, [field.key]: event.currentTarget.value }))
                                    }
                                    placeholder={field.label + (field.required ? "" : ` (${language.t("common.optional")})`)}
                                  />
                                </div>
                              )}
                            </For>

                            <Show when={form.whatsappProvider === "izapia"}>
                              <div class="flex flex-col gap-3 p-1">
                                <div class="flex items-center justify-between">
                                  <div>
                                    <label class="settings-v2-server-dialog-label font-medium">
                                      {language.t("settings.agentui.field.whatsapp.izapiaSessions.label")}
                                    </label>
                                    <p class="text-11-regular text-v2-text-text-muted mt-0.5">Marque quais números este agente deve escutar.</p>
                                  </div>
                                  <ButtonV2
                                    variant="outline"
                                    size="small"
                                    disabled={!form.whatsappConfig.apiKey?.trim() || izapiaSessionsLoading()}
                                    onClick={() => void fetchIzapiaSessions({ force: true })}
                                  >
                                    {izapiaSessionsLoading()
                                      ? language.t("settings.agentui.field.whatsapp.izapiaSessions.loading")
                                      : `${language.t("settings.agentui.field.whatsapp.izapiaSessions.fetch")} ⟳`}
                                  </ButtonV2>
                                </div>
                                <Show when={izapiaSessionsError()}>
                                  <span class="settings-v2-server-dialog-error">{izapiaSessionsError()}</span>
                                </Show>
                                <Show when={izapiaSessions().length > 0}>
                                  <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                    <For each={izapiaSessions()}>
                                       {(session) => (
                                         <label
                                           class={`
                                             flex cursor-pointer items-center justify-between gap-2 rounded-md border
                                             px-3 py-2 text-13-regular transition-all duration-150
                                             ${
                                               form.whatsappSessionIds.includes(session.id)
                                                 ? "border-v2-border-border-base bg-v2-background-bg-layer-02/70 text-v2-text-text-base shadow-sm"
                                                 : "border-v2-border-border-base/50 bg-v2-surface-surface-raised/20 text-v2-text-text-muted hover:border-v2-border-border-base hover:bg-v2-background-bg-layer-01"
                                             }
                                           `}
                                         >
                                          <span class="flex min-w-0 items-center gap-2.5">
                                            <input
                                              type="checkbox"
                                              class="rounded border-v2-border-border-base text-v2-primary-primary-base focus:ring-1 focus:ring-v2-border-border-focus"
                                              checked={form.whatsappSessionIds.includes(session.id)}
                                              onChange={(event) => toggleIzapiaSession(session.id, event.currentTarget.checked)}
                                            />
                                            <span class="truncate font-medium text-v2-text-text-base">
                                              {session.name || session.jid || session.id}
                                            </span>
                                          </span>
                                          <span class="shrink-0 rounded px-1.5 py-0.5 text-11-regular font-mono bg-v2-surface-surface-base text-v2-text-text-muted border border-v2-border-border-base">
                                            {session.status}
                                          </span>
                                        </label>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>

                              <div class="flex flex-col gap-3 p-1">
                                <div class="flex items-center justify-between">
                                  <div>
                                    <label class="settings-v2-server-dialog-label font-medium">
                                      {language.t("settings.agentui.field.whatsapp.izapiaGroups.label")}
                                    </label>
                                    <p class="text-11-regular text-v2-text-text-muted mt-0.5">
                                      {language.t("settings.agentui.field.whatsapp.izapiaGroups.hint")}
                                    </p>
                                  </div>
                                  <ButtonV2
                                    variant="outline"
                                    size="small"
                                    disabled={form.whatsappSessionIds.length === 0 || izapiaGroupsLoading()}
                                    onClick={() => void fetchIzapiaGroups({ force: true })}
                                  >
                                    {izapiaGroupsLoading()
                                      ? language.t("settings.agentui.field.whatsapp.izapiaGroups.loading")
                                      : `${language.t("settings.agentui.field.whatsapp.izapiaGroups.fetch")} ⟳`}
                                  </ButtonV2>
                                </div>
                                <Show when={izapiaGroupsError()}>
                                  <span class="settings-v2-server-dialog-error">{izapiaGroupsError()}</span>
                                </Show>
                                <Show when={izapiaGroups().length > 0}>
                                  <div class="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                                     <For each={izapiaGroups()}>
                                       {(group) => (
                                         <div
                                           class={`
                                             flex items-center justify-between gap-2 rounded-md border
                                             px-3 py-2 text-13-regular transition-all duration-150
                                             ${
                                               form.whatsappAllowedGroups.includes(group.id)
                                                 ? "border-v2-border-border-base bg-v2-background-bg-layer-02/70 text-v2-text-text-base shadow-sm"
                                                 : "border-v2-border-border-base/50 bg-v2-surface-surface-raised/20 text-v2-text-text-muted hover:border-v2-border-border-base hover:bg-v2-background-bg-layer-01"
                                             }
                                           `}
                                         >
                                           <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                                             <input
                                               type="checkbox"
                                               class="rounded border-v2-border-border-base text-v2-primary-primary-base focus:ring-1 focus:ring-v2-border-border-focus"
                                               checked={form.whatsappAllowedGroups.includes(group.id)}
                                               onChange={(event) => toggleIzapiaGroup(group.id, event.currentTarget.checked)}
                                             />
                                             <span class="truncate font-medium text-v2-text-text-base">{group.subject}</span>
                                           </label>
                                            <div class="flex items-center gap-2 shrink-0">
                                              <ButtonV2
                                                variant="outline"
                                                size="small"
                                                class="text-11-medium px-2 py-0.5 h-6"
                                                onClick={(e: MouseEvent) => {
                                                  e.preventDefault()
                                                  e.stopPropagation()
                                                  dialog.push(() => (
                                                    <DialogIzapiaGroupParticipants
                                                      group={group}
                                                      apiKey={form.whatsappConfig.apiKey?.trim() ?? ""}
                                                      initialGroupSenders={form.whatsappGroupAllowedSenders[group.id]}
                                                      initialGlobalSenders={form.whatsappAllowedSenders}
                                                      onApply={({ groupSenders, globalSenders }) => {
                                                        setForm("whatsappGroupAllowedSenders", (map) => {
                                                          const next = { ...map }
                                                          if (groupSenders.length > 0) {
                                                            next[group.id] = groupSenders
                                                          } else {
                                                            delete next[group.id]
                                                          }
                                                          return next
                                                        })
                                                        setForm("whatsappAllowedSenders", globalSenders)
                                                      }}
                                                    />
                                                  ))
                                                }}
                                              >
                                                {language.t("settings.agentui.field.whatsapp.izapiaGroups.participants")}
                                                <Show when={form.whatsappGroupAllowedSenders[group.id]?.length}>
                                                  {(count) => (
                                                    <span class="ml-1 rounded-full bg-v2-primary-primary-base/20 px-1 text-9-medium text-v2-primary-primary-base">
                                                      {count()}
                                                    </span>
                                                  )}
                                                </Show>
                                              </ButtonV2>
                                              <span class="rounded px-1.5 py-0.5 text-11-regular font-mono bg-v2-surface-surface-base text-v2-text-text-muted border border-v2-border-border-base">
                                                {group.participantCount}
                                              </span>
                                            </div>
                                         </div>
                                       )}
                                     </For>
                                   </div>
                                </Show>
                              </div>

                              <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01/30 p-3">
                                <div class="flex flex-col gap-0.5 pr-4">
                                  <span class="text-13-medium text-v2-text-text-base">
                                    {language.t("settings.agentui.field.whatsapp.mentionOnly.label")}
                                  </span>
                                  <p class="text-11-regular text-v2-text-text-muted">
                                    {language.t("settings.agentui.field.whatsapp.mentionOnly.hint")}
                                  </p>
                                </div>
                                <Switch
                                  checked={form.whatsappMentionOnly}
                                  onChange={(checked) => setForm("whatsappMentionOnly", checked)}
                                />
                              </div>
                            </Show>

                            <Show when={form.whatsappProvider === "papi"}>
                              <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02/60 p-3.5">
                                <div class="flex items-center gap-2 text-v2-text-text-base font-medium text-13-medium">
                                  <span class="flex h-5 w-5 items-center justify-center rounded-full bg-v2-primary-primary-base/20 text-v2-primary-primary-base text-11-medium">ℹ</span>
                                  Como conectar a Papi Cloud (papi.api.br)
                                </div>
                                <p class="text-12-regular text-v2-text-text-muted leading-relaxed">
                                  1. Acesse o painel em <a href="https://papi.api.br" target="_blank" rel="noreferrer" class="text-v2-text-text-accent underline font-medium">papi.api.br</a> e faça login.<br />
                                  2. No menu do seu perfil, copie o seu <strong>Token do Perfil</strong> (<code class="font-mono text-11-regular px-1 py-0.5 rounded bg-v2-surface-surface-base">x-panel-token</code>).<br />
                                  3. Cole o token no campo acima e clique em <strong>Buscar Instâncias</strong> para carregar ou criar conexões.<br />
                                  4. Selecione a instância desejada e clique em <strong>Configurar Webhook</strong> para receber mensagens automaticamente.
                                </p>
                              </div>

                              <div class="flex flex-col gap-3 p-1">
                                <div class="flex items-center justify-between">
                                  <div>
                                    <label class="settings-v2-server-dialog-label font-medium">
                                      Instâncias Papi Cloud
                                    </label>
                                    <p class="text-11-regular text-v2-text-text-muted mt-0.5">Marque quais instâncias este agente deve escutar.</p>
                                  </div>
                                  <ButtonV2
                                    variant="outline"
                                    size="small"
                                    disabled={!form.whatsappConfig.token?.trim() || papiInstancesLoading()}
                                    onClick={() => void fetchPapiInstances({ force: true })}
                                  >
                                    {papiInstancesLoading() ? "Carregando…" : "Buscar Instâncias ⟳"}
                                  </ButtonV2>
                                </div>

                                <Show when={papiInstancesError()}>
                                  <span class="settings-v2-server-dialog-error">{papiInstancesError()}</span>
                                </Show>

                                <div class="flex items-center gap-2 rounded-md border border-dashed border-v2-border-border-base/70 p-2 bg-v2-background-bg-layer-01/30">
                                  <TextInputV2
                                    class="flex-1"
                                    placeholder="Nome da nova instância (ex: suporte-atendimento)"
                                    value={papiNewInstanceName()}
                                    onInput={(e) => setPapiNewInstanceName(e.currentTarget.value)}
                                  />
                                  <ButtonV2
                                    variant="outline"
                                    size="small"
                                    disabled={!papiNewInstanceName().trim() || !form.whatsappConfig.token?.trim() || papiCreatingInstance()}
                                    onClick={() => void createPapiInstance()}
                                  >
                                    {papiCreatingInstance() ? "Criando…" : "+ Criar Instância"}
                                  </ButtonV2>
                                </div>
                                <Show when={papiCreateError()}>
                                  <span class="settings-v2-server-dialog-error">{papiCreateError()}</span>
                                </Show>

                                <Show when={papiInstances().length > 0}>
                                  <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                    <For each={papiInstances()}>
                                      {(instance) => (
                                        <div
                                          class={`
                                            flex items-center justify-between gap-2 rounded-md border
                                            px-3 py-2 text-13-regular transition-all duration-150
                                            ${
                                              form.whatsappSessionIds.includes(instance.id)
                                                ? "border-v2-border-border-base bg-v2-background-bg-layer-02/70 text-v2-text-text-base shadow-sm"
                                                : "border-v2-border-border-base/50 bg-v2-surface-surface-raised/20 text-v2-text-text-muted hover:border-v2-border-border-base hover:bg-v2-background-bg-layer-01"
                                            }
                                          `}
                                        >
                                          <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                                            <input
                                              type="checkbox"
                                              class="rounded border-v2-border-border-base text-v2-primary-primary-base focus:ring-1 focus:ring-v2-border-border-focus"
                                              checked={form.whatsappSessionIds.includes(instance.id)}
                                              onChange={(event) => togglePapiInstance(instance.id, event.currentTarget.checked)}
                                            />
                                            <span class="truncate font-medium text-v2-text-text-base">
                                              {instance.name || instance.jid || instance.id}
                                            </span>
                                          </label>
                                          <div class="flex items-center gap-2 shrink-0">
                                            <ButtonV2
                                              variant="outline"
                                              size="small"
                                              class="text-11-medium px-2 py-0.5 h-6"
                                              disabled={papiWebhookConfiguring()}
                                              onClick={(e: MouseEvent) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                void configurePapiWebhook(instance.id)
                                              }}
                                            >
                                              {papiWebhookConfiguring() ? "Configurando…" : "Configurar Webhook"}
                                            </ButtonV2>
                                            <span class="shrink-0 rounded px-1.5 py-0.5 text-11-regular font-mono bg-v2-surface-surface-base text-v2-text-text-muted border border-v2-border-border-base">
                                              {instance.status}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>

                                <Show when={papiWebhookSuccess()}>
                                  <span class="text-12-medium text-emerald-500">{papiWebhookSuccess()}</span>
                                </Show>
                                <Show when={papiWebhookError()}>
                                  <span class="settings-v2-server-dialog-error">{papiWebhookError()}</span>
                                </Show>
                              </div>

                              <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01/40 p-4">
                                <div class="border-b border-v2-border-border-base pb-3">
                                  <span class="text-13-medium text-v2-text-text-base">Regras de Comunicação &amp; Allowlist (Papi Cloud)</span>
                                  <p class="text-11-regular text-v2-text-text-muted mt-0.5">
                                    Defina quais números e grupos o agente tem permissão para responder.
                                  </p>
                                </div>

                                {/* Allowlist de Contatos / Telefones */}
                                <div class="flex flex-col gap-2">
                                  <div class="flex items-center justify-between">
                                    <label class="settings-v2-server-dialog-label font-medium">
                                      Allowlist de Números / Contatos Permitidos
                                    </label>
                                    <Show
                                      when={form.whatsappAllowedSenders.trim()}
                                      fallback={
                                        <span class="rounded bg-emerald-500/10 px-2 py-0.5 text-10-medium text-emerald-400 border border-emerald-500/20">
                                          🔓 Aberto ao público (responde a todos)
                                        </span>
                                      }
                                    >
                                      <span class="rounded bg-amber-500/10 px-2 py-0.5 text-10-medium text-amber-400 border border-amber-500/20">
                                        🔒 Restrito ({form.whatsappAllowedSenders.split(/[,\n]/).filter((s) => s.trim().length > 0).length} número(s) autorizados)
                                      </span>
                                    </Show>
                                  </div>
                                  <TextInputV2
                                    value={form.whatsappAllowedSenders}
                                    onInput={(event) => setForm("whatsappAllowedSenders", event.currentTarget.value)}
                                    placeholder="ex.: 5511999998888, 5585998490991 (separados por vírgula)"
                                  />
                                  <p class="text-11-regular text-v2-text-text-muted leading-relaxed">
                                    Informe os telefones com DDI e DDD autorizados a conversar com o agente. Deixe em <strong>branco</strong> para permitir que qualquer pessoa converse com o agente.
                                  </p>
                                </div>

                                {/* Allowlist de Grupos */}
                                <div class="flex flex-col gap-3 pt-3 border-t border-v2-border-border-base/70">
                                  <div class="flex items-center justify-between">
                                    <div>
                                      <label class="settings-v2-server-dialog-label font-medium">
                                        Allowlist de Grupos do WhatsApp
                                      </label>
                                      <p class="text-11-regular text-v2-text-text-muted mt-0.5">
                                        Marque ou adicione os grupos autorizados. Grupos não listados serão ignorados pelo agente.
                                      </p>
                                    </div>
                                    <ButtonV2
                                      variant="outline"
                                      size="small"
                                      disabled={form.whatsappSessionIds.length === 0 || papiGroupsLoading()}
                                      onClick={() => void fetchPapiGroups({ force: true })}
                                    >
                                      {papiGroupsLoading() ? "Carregando…" : "Buscar grupos ⟳"}
                                    </ButtonV2>
                                  </div>

                                  <div class="flex items-center gap-2">
                                    <TextInputV2
                                      class="flex-1"
                                      placeholder="Adicionar ID de grupo manualmente (ex: 120363028391823901@g.us)"
                                      value={manualGroupId()}
                                      onInput={(e) => setManualGroupId(e.currentTarget.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault()
                                          addManualGroup()
                                        }
                                      }}
                                    />
                                    <ButtonV2
                                      variant="outline"
                                      size="small"
                                      disabled={!manualGroupId().trim()}
                                      onClick={addManualGroup}
                                    >
                                      + Adicionar ID
                                    </ButtonV2>
                                  </div>

                                  <Show when={papiGroupsError()}>
                                    <span class="settings-v2-server-dialog-error">{papiGroupsError()}</span>
                                  </Show>

                                  <Show
                                    when={form.whatsappAllowedGroups.length > 0}
                                    fallback={
                                      <p class="text-11-regular text-v2-text-text-muted italic">
                                        Nenhum grupo autorizado. O agente só responderá a conversas diretas individuais.
                                      </p>
                                    }
                                  >
                                    <div class="flex flex-col gap-1.5">
                                      <span class="text-11-medium text-v2-text-text-base">
                                        Grupos autorizados ({form.whatsappAllowedGroups.length}):
                                      </span>
                                      <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                                        <For each={form.whatsappAllowedGroups}>
                                          {(groupId) => {
                                            const group = papiGroups().find((g) => g.id === groupId)
                                            return (
                                              <span class="inline-flex items-center gap-1.5 rounded-md border border-v2-border-border-base bg-v2-surface-surface-raised px-2.5 py-1 text-12-regular text-v2-text-text-base">
                                                <span class="truncate max-w-[200px]">{group?.subject || groupId}</span>
                                                <button
                                                  type="button"
                                                  class="text-v2-text-text-muted hover:text-red-400 transition-colors ml-1 font-bold"
                                                  onClick={() => removeGroup(groupId)}
                                                  aria-label="Remover grupo"
                                                >
                                                  ✕
                                                </button>
                                              </span>
                                            )
                                          }}
                                        </For>
                                      </div>
                                    </div>
                                  </Show>

                                  <Show when={papiGroups().length > 0}>
                                    <div class="flex flex-col gap-1.5 mt-1">
                                      <span class="text-11-medium text-v2-text-text-base">Grupos encontrados na sua conta:</span>
                                      <div class="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                                        <For each={papiGroups()}>
                                          {(group) => (
                                            <label
                                              class={`
                                                flex items-center justify-between gap-2 rounded-md border
                                                px-3 py-1.5 text-12-regular transition-all duration-150 cursor-pointer
                                                ${
                                                  form.whatsappAllowedGroups.includes(group.id)
                                                    ? "border-v2-border-border-base bg-v2-background-bg-layer-02/70 text-v2-text-text-base shadow-sm"
                                                    : "border-v2-border-border-base/50 bg-v2-surface-surface-raised/20 text-v2-text-text-muted hover:border-v2-border-border-base hover:bg-v2-background-bg-layer-01"
                                                }
                                              `}
                                            >
                                              <span class="flex min-w-0 flex-1 items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  class="rounded border-v2-border-border-base text-v2-primary-primary-base focus:ring-1 focus:ring-v2-border-border-focus"
                                                  checked={form.whatsappAllowedGroups.includes(group.id)}
                                                  onChange={(event) =>
                                                    setForm("whatsappAllowedGroups", (list) =>
                                                      event.currentTarget.checked
                                                        ? [...list, group.id]
                                                        : list.filter((item) => item !== group.id),
                                                    )
                                                  }
                                                />
                                                <span class="truncate font-medium text-v2-text-text-base">{group.subject}</span>
                                              </span>
                                              <span class="rounded px-1.5 py-0.5 text-10-regular font-mono bg-v2-surface-surface-base text-v2-text-text-muted border border-v2-border-border-base shrink-0">
                                                {group.participantCount ? `${group.participantCount} membros` : group.id}
                                              </span>
                                            </label>
                                          )}
                                        </For>
                                      </div>
                                    </div>
                                  </Show>

                                  <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01/30 p-3 mt-1">
                                    <div class="flex flex-col gap-0.5 pr-4">
                                      <span class="text-12-medium text-v2-text-text-base">
                                        Apenas quando mencionado (@) nos grupos
                                      </span>
                                      <p class="text-11-regular text-v2-text-text-muted">
                                        Quando ativado, o agente só responderá nos grupos autorizados se for expressamente marcado com @ ou citado.
                                      </p>
                                    </div>
                                    <Switch
                                      checked={form.whatsappMentionOnly}
                                      onChange={(checked) => setForm("whatsappMentionOnly", checked)}
                                    />
                                  </div>
                                </div>
                              </div>
                            </Show>

                            <div class="flex flex-col gap-1.5">
                              <label class="settings-v2-server-dialog-label font-medium">
                                {language.t("settings.agentui.field.whatsapp.directory.label")}
                              </label>
                              <p class="text-11-regular text-v2-text-text-muted">
                                {language.t("settings.agentui.field.whatsapp.directory.hint")}
                              </p>
                              <select
                                class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-13-regular text-v2-text-text-base"
                                value={form.whatsappDirectory || ""}
                                onChange={(event) => setForm("whatsappDirectory", event.currentTarget.value || undefined)}
                              >
                                <option value="">{language.t("settings.agentui.field.whatsapp.directory.default")}</option>
                                <For each={home.project.list()}>
                                  {(proj) => (
                                    <option value={proj.worktree}>
                                      {proj.name || proj.worktree}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </div>

                            <div class="flex flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-4">
                              <span class="text-12-medium text-v2-text-text-base">Host &amp; Webhook Reverso</span>
                              <Show when={isPrivateServerUrl() && !publicTunnelUrl()}>
                                <div class="flex flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-3">
                                  <div class="flex flex-col gap-2">
                                    <p class="text-11-regular text-v2-text-text-muted leading-relaxed">
                                      {language.t("settings.agentui.field.whatsapp.tunnel.tailscale.hint")}
                                    </p>
                                    <ButtonV2
                                      variant="outline"
                                      size="small"
                                      disabled={tailscaleDetecting()}
                                      onClick={() => void useTailscaleIp()}
                                    >
                                      {tailscaleDetecting()
                                        ? language.t("settings.agentui.field.whatsapp.tunnel.tailscale.detecting")
                                        : language.t("settings.agentui.field.whatsapp.tunnel.tailscale.use")}
                                    </ButtonV2>
                                    <Show when={tailscaleError()}>
                                      <span class="settings-v2-server-dialog-error">{tailscaleError()}</span>
                                    </Show>
                                  </div>

                                  <div class="flex flex-col gap-2 border-t border-v2-border-border-base pt-2.5">
                                    <p class="text-11-regular text-v2-text-text-muted leading-relaxed">
                                      {language.t("settings.agentui.field.whatsapp.tunnel.tailscaleFunnel.hint")}
                                    </p>
                                    <ButtonV2
                                      variant="outline"
                                      size="small"
                                      disabled={funnelStarting()}
                                      onClick={() => void useTailscaleFunnel()}
                                    >
                                      {funnelStarting()
                                        ? language.t("settings.agentui.field.whatsapp.tunnel.tailscaleFunnel.starting")
                                        : language.t("settings.agentui.field.whatsapp.tunnel.tailscaleFunnel.use")}
                                    </ButtonV2>
                                    <Show when={funnelError()}>
                                      <span class="settings-v2-server-dialog-error">{funnelError()}</span>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              <Show when={publicTunnelUrl()}>
                                <div class="flex items-center justify-between gap-2 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-2.5">
                                  <span class="text-11-regular text-v2-text-text-accent font-mono break-all select-all">
                                    {language.t("settings.agentui.field.whatsapp.tunnel.active", { url: publicTunnelUrl()! })}
                                  </span>
                                  <ButtonV2
                                    variant="ghost"
                                    size="small"
                                    class="shrink-0"
                                    onClick={() => {
                                      setPublicTunnelUrl(undefined)
                                      setForm("whatsappPublicUrl", undefined)
                                    }}
                                  >
                                    {language.t("settings.agentui.field.whatsapp.tunnel.clear")}
                                  </ButtonV2>
                                </div>
                              </Show>
                              <Show
                                when={whatsappWebhookUrl()}
                                fallback={
                                  <p class="text-11-regular text-v2-text-text-muted">
                                    {language.t("settings.agentui.field.whatsapp.webhookAfterSave")}
                                  </p>
                                }
                              >
                                {(url) => (
                                  <div class="flex flex-col gap-3">
                                    <div class="flex flex-col gap-1.5">
                                      <label class="settings-v2-server-dialog-label font-medium">
                                        {language.t("settings.agentui.field.whatsapp.webhookUrl")}
                                      </label>
                                      <TextInputV2
                                        value={url()}
                                        readOnly
                                        showCopyButton
                                        class="!w-full self-stretch"
                                        onCopyClick={() => {
                                          void navigator.clipboard?.writeText(url())
                                          showToast({ variant: "success", icon: "circle-check", title: "URL do Webhook copiada!" })
                                        }}
                                      />
                                    </div>
                                    <div class="flex flex-col gap-1.5">
                                      <label class="settings-v2-server-dialog-label font-medium">
                                        {language.t("settings.agentui.field.whatsapp.webhookSecret")}
                                      </label>
                                      <TextInputV2
                                        value={form.whatsappWebhookSecret}
                                        readOnly
                                        showCopyButton
                                        class="!w-full self-stretch"
                                        onCopyClick={() => {
                                          void navigator.clipboard?.writeText(form.whatsappWebhookSecret)
                                          showToast({ variant: "success", icon: "circle-check", title: "Secret copiado!" })
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </Show>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>

                    <div class="flex w-full flex-col gap-6 lg:w-[420px] shrink-0">
                      <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                        <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                          <div class="flex items-center gap-2">
                            <span class="size-2 rounded-full bg-sky-500" />
                            <span class="text-14-medium text-v2-text-text-base">{language.t("settings.agentui.field.telegram")}</span>
                          </div>
                          <Switch checked={form.telegram} onChange={(checked) => setForm("telegram", checked)} />
                        </div>
                        <Show when={form.telegram}>
                          <div class="flex flex-col gap-2">
                            <TextInputV2
                              value={form.telegramToken}
                              onInput={(event) => setForm("telegramToken", event.currentTarget.value)}
                              placeholder={language.t("settings.agentui.field.telegramToken.placeholder")}
                            />
                            <p class="text-11-regular text-v2-text-text-muted leading-relaxed">
                              {language.t("settings.agentui.field.telegramToken.hint")}
                            </p>
                          </div>
                        </Show>
                      </div>

                      <div class="flex flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                        <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
                          <span class="text-14-medium text-v2-text-text-base">Diagnóstico de Saúde</span>
                          <ButtonV2 variant="ghost" size="small" onClick={openDiagnose}>
                            Abrir ↗
                          </ButtonV2>
                        </div>
                        <p class="text-11-regular text-v2-text-text-muted leading-relaxed">
                          Verifique em tempo real se os tokens, o gateway WhatsApp e os modelos configurados estão operacionais.
                        </p>
                        <ButtonV2 variant="outline" class="w-full justify-center" onClick={openDiagnose}>
                          ⚡ Diagnosticar Canais
                        </ButtonV2>
                      </div>
                    </div>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="tools">
                  <div class="flex w-full flex-col gap-6">
                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="border-b border-v2-border-border-base pb-3">
                        <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.mcpServers")}</label>
                        <p class="text-11-regular text-v2-text-text-muted mt-1">{language.t("settings.agentui.field.mcpServers.hint")}</p>
                      </div>
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
                          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            <For each={mcpServers()}>
                              {(name) => (
                                <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5 shadow-sm">
                                  <span class="text-13-regular font-medium text-v2-text-text-base truncate mr-2">{name}</span>
                                  <Switch
                                    checked={form.mcpServers.includes(name)}
                                    onChange={(checked) => toggleMcpServer(name, checked)}
                                  />
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>

                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="border-b border-v2-border-border-base pb-3">
                        <span class="text-14-medium text-v2-text-text-base">Módulos &amp; Permissões do Sistema</span>
                      </div>
                      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.routines")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">{language.t("settings.agentui.field.routines.hint")}</p>
                          </div>
                          <Switch
                            checked={form.routinesEnabled}
                            onChange={(checked) => setForm("routinesEnabled", checked)}
                          />
                        </div>

                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.agenda")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">{language.t("settings.agentui.field.agenda.hint")}</p>
                          </div>
                          <Switch
                            checked={form.agendaEnabled}
                            onChange={(checked) => setForm("agendaEnabled", checked)}
                          />
                        </div>

                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.memory")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">{language.t("settings.agentui.field.memory.hint")}</p>
                          </div>
                          <Switch
                            checked={form.memoryEnabled}
                            onChange={(checked) => setForm("memoryEnabled", checked)}
                          />
                        </div>

                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.filesystem")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">{language.t("settings.agentui.field.filesystem.hint")}</p>
                          </div>
                          <Switch
                            checked={form.filesystemEnabled}
                            onChange={(checked) => setForm("filesystemEnabled", checked)}
                          />
                        </div>

                        <div class="flex items-center justify-between rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3.5 md:col-span-2">
                          <div>
                            <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.terminal")}</label>
                            <p class="text-11-regular text-v2-text-text-muted mt-0.5">{language.t("settings.agentui.field.terminal.hint")}</p>
                          </div>
                          <Switch
                            checked={form.terminalEnabled}
                            onChange={(checked) => setForm("terminalEnabled", checked)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsV2.Content>

                <TabsV2.Content value="knowledge">
                  <div class="flex w-full flex-col gap-6">
                    <div class="flex flex-col gap-4 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-5">
                      <div class="border-b border-v2-border-border-base pb-3">
                        <label class="settings-v2-server-dialog-label font-medium">{language.t("settings.agentui.field.ragSources")}</label>
                        <p class="text-11-regular text-v2-text-text-muted mt-1">Adicione textos fixos ou URLs externas com informações para enriquecer o contexto do agente.</p>
                      </div>
                      <For each={form.ragSources}>
                        {(source, index) => (
                          <div class="flex items-start gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-3">
                            <TextInputV2
                              class="w-[180px] shrink-0"
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
                      <ButtonV2 variant="outline" class="self-start" onClick={addRagSource}>
                        {language.t("settings.agentui.rag.add")}
                      </ButtonV2>
                      <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.agentui.rag.note")}</p>
                    </div>
                  </div>
                </TabsV2.Content>
              </div>
            </ScrollView>
          </TabsV2>
        </div>
      </Show>
    </div>
  )
}
