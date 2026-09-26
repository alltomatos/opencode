import { createEffect, createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useServerSDK } from "@/context/server-sdk"
import { useDirectoryPicker } from "@/components/directory-picker"
import { ModelPickerV2 } from "@/components/batuta/model-picker-v2"
import { sessionHref } from "@/utils/session-route"
import { useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogMcpAddV2 } from "@/components/settings-v2/dialog-mcp-v2"
import { GlobalLoading } from "@/components/global-loading"
import type { McpToolRef } from "./summary"

type WhenKind = "daily" | "weekdays" | "interval" | "cron" | "manual"
type IntervalUnit = "minutes" | "hours"
type PermissionMode = "auto" | "bypass" | "default"

interface RoutineTemplate {
  name: string
  desc: string
  instructions: string
  tools: { server: string; tool: string }[]
}

const TEMPLATES: RoutineTemplate[] = [
  {
    name: "Email ➔ Notificação WhatsApp",
    desc: "Lê os emails mais recentes da conta protectit via mcpmail e envia notificação no WhatsApp pelo izapia.",
    instructions:
      "Acesse a conta de email 'ronaldodavi@protectit.com.br' (Protectit) usando o MCP de email (mcpmail), busque os emails recentes da caixa de entrada (INBOX), faça um resumo dos assuntos/remetentes mais relevantes e envie uma mensagem de notificação no WhatsApp usando o MCP izapia na sessão 'alltomatosbr' para o número 8598490991.",
    tools: [
      { server: "mcpmail", tool: "mail_search_messages" },
      { server: "mcpmail", tool: "mail_get_message" },
      { server: "izapia", tool: "izapia_request" },
    ],
  },
  {
    name: "Code Review diário de commits",
    desc: "Analisa os commits das últimas 24h na pasta do projeto e sintetiza alterações e riscos.",
    instructions:
      "Analise os commits das últimas 24 horas no repositório. Resuma o que mudou, destaque quaisquer padrões arriscados, bugs potenciais ou testes ausentes e anote pontos relevantes para acompanhar.",
    tools: [],
  },
  {
    name: "Comparar repositórios / Atualizações",
    desc: "Compara o repositório local ou fork com o upstream ou outro repositório para sugerir melhorias.",
    instructions:
      "Compare as duas pastas/repositórios configurados. Identifique commits, arquivos e melhorias que existem em um mas não no outro, apontando novidades, correções de bugs e possíveis conflitos.",
    tools: [],
  },
  {
    name: "Análise de Documentos e Planilhas",
    desc: "Inspeciona arquivos recentes, planilhas ou relatórios e gera um sumário executivo.",
    instructions:
      "Analise os documentos e planilhas presentes no diretório, extraia os principais indicadores e métricas e crie um sumário executivo com os pontos de destaque.",
    tools: [],
  },
]

export const RoutineFormPage: Component = () => {
  const server = useServer()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const dialog = useDialog()
  const params = useParams<{ id?: string }>()
  const pickDirectory = useDirectoryPicker()
  const isEditing = () => Boolean(params.id)

  // Nome e Descrição da Rotina
  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")

  // Quando
  const [whenKind, setWhenKind] = createSignal<WhenKind>("daily")
  const [dailyTimes, setDailyTimes] = createSignal<string[]>(["09:00"])
  const [nextDailyTime, setNextDailyTime] = createSignal("13:00")
  const [intervalValue, setIntervalValue] = createSignal("30")
  const [intervalUnit, setIntervalUnit] = createSignal<IntervalUnit>("minutes")
  const [customCron, setCustomCron] = createSignal("0 9 * * *")

  const addDailyTime = () => {
    const time = nextDailyTime()
    if (!time || dailyTimes().includes(time)) return
    setDailyTimes((prev) => [...prev, time].sort())
  }
  const removeDailyTime = (time: string) => setDailyTimes((prev) => prev.filter((t) => t !== time))

  // Carregar dados se for edição
  const [initialLoading, setInitialLoading] = createSignal(isEditing())
  createEffect(async () => {
    if (!params.id) {
      setInitialLoading(false)
      return
    }
    try {
      const scheduleClient = (serverSDK().client as any).schedule ?? (serverSDK().client as any).v2?.schedule
      const listRes = await scheduleClient.list()
      const found = (listRes.data ?? []).find((s: any) => s.id === params.id)
      if (!found) {
        setInitialLoading(false)
        return
      }

      setName(found.name ?? "")
      setDescription(found.description ?? "")

      if (found.trigger) {
        if (found.trigger.kind === "cron") {
          const parts = String(found.trigger.expr ?? "").split(" ")
          if (parts[4] === "1-5") setWhenKind("weekdays")
          else if (parts.length === 5 && parts[0] !== "*" && parts[1] !== "*") setWhenKind("daily")
          else setWhenKind("cron")
          setCustomCron(found.trigger.expr)
          const hours = (parts[1] || "").split(",")
          const mins = (parts[0] || "").split(",")
          if (hours.length > 0 && hours[0] !== "*") {
            const times: string[] = []
            for (const h of hours) {
              for (const m of mins) {
                times.push(`${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`)
              }
            }
            if (times.length > 0) setDailyTimes(times)
          }
        } else if (found.trigger.kind === "interval") {
          setWhenKind("interval")
          const totalMin = Math.round(Number(found.trigger.ms || 0) / 60000)
          if (totalMin % 60 === 0 && totalMin > 0) {
            setIntervalUnit("hours")
            setIntervalValue(String(totalMin / 60))
          } else {
            setIntervalUnit("minutes")
            setIntervalValue(String(totalMin))
          }
        } else if (found.trigger.kind === "manual") {
          setWhenKind("manual")
        }
      }

      if (found.action) {
        if (found.action.kind === "shell") {
          setAdvanced(true)
          setCommand(found.action.command ?? "")
        } else if (found.action.kind === "skill") {
          setAdvanced(false)
          setInstructions(found.action.instructions ?? "")
          if (found.action.model) setModel(found.action.model)
          if (found.action.permission) setPermissionMode(found.action.permission)
          if (found.action.mcpTools && Array.isArray(found.action.mcpTools)) {
            setMcpTools([...found.action.mcpTools])
          }
          if (found.action.workspaces && Array.isArray(found.action.workspaces)) {
            setWorkspaces([...found.action.workspaces])
          } else if (found.workspace) {
            setWorkspaces([found.workspace])
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setInitialLoading(false)
    }
  })

  // Como
  const [advanced, setAdvanced] = createSignal(false)
  const [instructions, setInstructions] = createSignal("")
  const [command, setCommand] = createSignal("")

  // Onde (Múltiplas Pastas / Repositórios)
  const [workspaces, setWorkspaces] = createSignal<string[]>([])
  const [customPathInput, setCustomPathInput] = createSignal("")

  const addWorkspacePath = (path: string) => {
    const trimmed = path.trim()
    if (!trimmed || workspaces().includes(trimmed)) return
    setWorkspaces((prev) => [...prev, trimmed])
    setCustomPathInput("")
  }

  const removeWorkspacePath = (path: string) => {
    setWorkspaces((prev) => prev.filter((p) => p !== path))
  }

  // Modelo de IA
  const [model, setModel] = createSignal<string>("")

  // Permissões
  const [permissionMode, setPermissionMode] = createSignal<PermissionMode>("auto")

  // Ferramentas MCP selecionadas
  const [mcpTools, setMcpTools] = createSignal<McpToolRef[]>([])
  const [selectedServer, setSelectedServer] = createSignal<string | undefined>(undefined)

  // Validação / Teste em tempo real
  const [testResult, setTestResult] = createSignal<{
    success?: boolean
    error?: string
    sessionId?: string
  } | null>(null)

  const [mcpStatus, { refetch: refetchMcpStatus }] = createResource(async () => {
    const result = await serverSDK().client.mcp.status()
    return Object.entries(result.data ?? {})
      .filter(([, value]) => value.status === "connected")
      .map(([name]) => name)
  })

  const openAddMcpModal = () => {
    dialog.show(() => <DialogMcpAddV2 onAdded={() => void refetchMcpStatus()} />)
  }

  // Auto-select first connected server if none selected
  createEffect(() => {
    const servers = mcpStatus() ?? []
    if (servers.length > 0 && !selectedServer()) {
      setSelectedServer(servers[0])
    }
  })

  const [mcpCatalog] = createResource(selectedServer, async (name) => {
    if (!name) return []
    const result = await serverSDK().client.mcp.catalog({ name })
    return result.data?.tools ?? []
  })

  const toggleTool = (server: string, tool: string) => {
    setMcpTools((prev) => {
      const exists = prev.some((t) => t.server === server && t.tool === tool)
      if (exists) return prev.filter((t) => !(t.server === server && t.tool === tool))
      return [...prev, { server, tool }]
    })
  }

  const selectAllToolsForServer = (server: string) => {
    const tools = mcpCatalog() ?? []
    setMcpTools((prev) => {
      const other = prev.filter((t) => t.server !== server)
      return [...other, ...tools.map((t) => ({ server, tool: t.name }))]
    })
  }

  const clearToolsForServer = (server: string) => {
    setMcpTools((prev) => prev.filter((t) => t.server !== server))
  }

  const applyTemplate = (tpl: RoutineTemplate) => {
    setName(tpl.name)
    setDescription(tpl.desc)
    setInstructions(tpl.instructions)
    if (tpl.tools.length > 0) {
      setMcpTools((prev) => {
        const set = new Map<string, McpToolRef>()
        for (const item of prev) set.set(`${item.server}:${item.tool}`, item)
        for (const item of tpl.tools) set.set(`${item.server}:${item.tool}`, item)
        return Array.from(set.values())
      })
    }
    showToast({ title: "Template aplicado", description: tpl.name })
  }

  const chooseDirectory = () => {
    pickDirectory({
      server: serverSDK().server,
      title: "Selecionar pasta ou repositório",
      onSelect: (result) => {
        if (typeof result === "string") {
          addWorkspacePath(result)
        } else if (Array.isArray(result)) {
          for (const item of result) {
            if (typeof item === "string") addWorkspacePath(item)
          }
        }
      },
    })
  }

  const buildCurrentAction = () => {
    return advanced()
      ? ({ kind: "shell", command: command() } as const)
      : ({
          kind: "skill",
          instructions: instructions(),
          mcpTools: mcpTools().length ? mcpTools() : undefined,
          workspaces: workspaces().length > 0 ? workspaces() : undefined,
          model: model() ? model() : undefined,
          permission: permissionMode(),
        } as const)
  }

  const canSave = () => {
    if (whenKind() === "daily" && dailyTimes().length === 0) return false
    if (whenKind() === "weekdays" && dailyTimes().length === 0) return false
    if (whenKind() === "cron" && !customCron().trim()) return false
    return advanced() ? command().trim().length > 0 : instructions().trim().length > 0
  }

  // Mutação para Validar / Testar Rotina
  const testMutation = useMutation(() => ({
    mutationFn: async () => {
      setTestResult(null)
      const action = buildCurrentAction()
      const primaryWorkspace = workspaces()[0] || undefined
      const scheduleClient = (serverSDK().client as any).schedule ?? (serverSDK().client as any).v2?.schedule
      const res = await scheduleClient.test({
        scheduleTestInput: {
          action,
          workspace: primaryWorkspace,
        },
      })
      return res.data
    },
    onSuccess: (data) => {
      setTestResult(data ?? { success: true })
      if (data?.success) {
        showToast({
          title: "Validação concluída com sucesso!",
          description: "A rotina foi executada perfeitamente.",
        })
      } else {
        showToast({
          title: "Falha na validação da rotina",
          description: data?.error || "Ocorreu um erro durante o teste.",
        })
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setTestResult({ success: false, error: message })
      showToast({ title: "Erro ao testar a rotina", description: message })
    },
  }))

  const createMutation = useMutation(() => ({
    mutationFn: async () => {
      const kind = whenKind()
      const primaryWorkspace = workspaces()[0] || undefined
      const action = buildCurrentAction()

      let trigger: any
      if (kind === "daily" || kind === "weekdays") {
        const hours = Array.from(new Set(dailyTimes().map((t) => Number(t.split(":")[0]) || 0))).sort((a, b) => a - b)
        const minutes = Array.from(new Set(dailyTimes().map((t) => Number(t.split(":")[1]) || 0))).sort((a, b) => a - b)
        const hourExpr = hours.join(",") || "*"
        const minuteExpr = minutes.join(",") || "0"
        const dowExpr = kind === "weekdays" ? "1-5" : "*"
        trigger = { kind: "cron", expr: `${minuteExpr} ${hourExpr} * * ${dowExpr}` }
      } else if (kind === "cron") {
        trigger = { kind: "cron", expr: customCron().trim() }
      } else if (kind === "interval") {
        trigger = {
          kind: "interval",
          ms:
            Math.max(1, Number(intervalValue()) || 0) *
            (intervalUnit() === "hours" ? 3_600_000 : 60_000),
        }
      } else {
        trigger = { kind: "manual" }
      }

      const scheduleClient = (serverSDK().client as any).schedule ?? (serverSDK().client as any).v2?.schedule
      if (isEditing()) {
        await scheduleClient.update({
          scheduleID: params.id,
          scheduleUpdateInput: {
            name: name().trim() || undefined,
            description: description().trim() || undefined,
            trigger,
            action,
            workspace: primaryWorkspace,
          },
        })
      } else {
        await scheduleClient.create({
          scheduleCreateInput: {
            name: name().trim() || undefined,
            description: description().trim() || undefined,
            trigger,
            action,
            workspace: primaryWorkspace,
          },
        })
      }
    },
    onSuccess: () => navigate("/rotinas"),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível salvar a rotina", description: message })
    },
  }))

  return (
    <div
      class={`
        m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={!initialLoading()} fallback={<GlobalLoading size="normal" class="flex-1" />}>
        <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[780px] flex-col gap-6 px-3 py-8 lg:px-6">
          {/* Header */}
          <div class="flex items-center gap-3">
            <IconButtonV2
              variant="ghost-muted"
              aria-label="Voltar"
              onClick={() => navigate("/rotinas")}
              icon={<IconV2 name="close" size="small" />}
            />
            <div class="flex flex-col">
              <h1 class="text-lg font-medium text-v2-text-text-base">
                {isEditing() ? "Editar rotina" : "Nova rotina"}
              </h1>
              <span class="text-12-regular text-text-weak">
                {isEditing()
                  ? "Atualize as configurações, agendamentos e instruções desta rotina."
                  : "Configure automações autônomas com suporte a múltiplos repositórios, ferramentas MCP e modelos."}
              </span>
            </div>
          </div>

          {/* Atalhos de Templates Rápidos */}
          <div class="flex flex-col gap-2.5 rounded-lg bg-v2-background-bg-layer-02 p-3.5 border border-v2-border-border-base">
            <div class="flex items-center justify-between">
              <span class="text-12-medium text-v2-text-text-base font-semibold">Modelos rápidos de rotina</span>
              <span class="text-11-regular text-text-weak">Clique para preencher as instruções e MCPs</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <For each={TEMPLATES}>
                {(tpl) => (
                  <button
                    type="button"
                    class={`
                      flex flex-col gap-1 p-3 rounded-md border border-v2-border-border-base text-left
                      bg-v2-background-bg-layer-01 hover:border-v2-border-border-strong hover:bg-v2-background-bg-base
                      transition-all cursor-pointer shadow-sm
                    `}
                    onClick={() => applyTemplate(tpl)}
                  >
                    <div class="flex items-center gap-1.5 font-medium text-13-medium text-v2-text-text-base">
                      <Icon name="task" size="small" class="text-v2-icon-icon-base" />
                      {tpl.name}
                    </div>
                    <p class="text-12-regular text-text-weak line-clamp-2 leading-relaxed">{tpl.desc}</p>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-5 rounded-lg bg-v2-background-bg-layer-02 p-4 border border-v2-border-border-base">
            {/* Identificação da Rotina (Nome e Descrição) */}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-v2-text-text-base font-semibold">Nome da rotina (opcional)</label>
                <TextInputV2
                  class="w-full"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  placeholder="Ex: Resumo diário de emails, Revisão de PRs..."
                />
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-v2-text-text-base font-semibold">Descrição curta (opcional)</label>
                <TextInputV2
                  class="w-full"
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  placeholder="Breve resumo da finalidade desta rotina"
                />
              </div>
            </div>

            {/* Quando */}
            <div class="flex min-w-0 flex-col gap-2.5 border-t border-v2-border-border-base pt-4">
              <label class="text-12-medium text-v2-text-text-base font-semibold">Quando rodar</label>
              <div class="flex min-w-0 flex-col gap-2.5">
                <div class="flex flex-wrap items-center gap-1 rounded-md bg-v2-background-bg-layer-01 p-1 self-start border border-v2-border-border-base">
                  <For
                    each={[
                      { value: "daily" as const, label: "Todo dia" },
                      { value: "weekdays" as const, label: "Dias úteis" },
                      { value: "interval" as const, label: "A cada" },
                      { value: "cron" as const, label: "Personalizado (cron)" },
                      { value: "manual" as const, label: "Manual" },
                    ]}
                  >
                    {(option) => (
                      <ButtonV2
                        type="button"
                        class="whitespace-nowrap h-7 text-12-medium px-2.5"
                        variant={whenKind() === option.value ? "contrast" : "neutral"}
                        onClick={() => setWhenKind(option.value)}
                      >
                        {option.label}
                      </ButtonV2>
                    )}
                  </For>
                </div>

                <Show when={whenKind() === "daily" || whenKind() === "weekdays"}>
                  <div class="flex flex-col gap-2 pt-1">
                    <Show when={dailyTimes().length > 0}>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={dailyTimes()}>
                          {(time) => (
                            <Tag class="flex items-center gap-1 text-12-medium">
                              <span>{time}</span>
                              <IconButtonV2
                                variant="ghost-muted"
                                aria-label="Remover horário"
                                onClick={() => removeDailyTime(time)}
                                icon={<IconV2 name="close" size="small" />}
                              />
                            </Tag>
                          )}
                        </For>
                      </div>
                    </Show>
                    <div class="flex items-center gap-2">
                      <TextInputV2
                        class="!w-[110px]"
                        type="time"
                        value={nextDailyTime()}
                        onInput={(event) => setNextDailyTime(event.currentTarget.value)}
                      />
                      <ButtonV2 type="button" variant="neutral" icon="plus" onClick={addDailyTime}>
                        Adicionar horário
                      </ButtonV2>
                    </div>
                    <span class="text-12-regular text-text-weak">
                      {whenKind() === "daily"
                        ? "Roda todos os dias nos horários indicados."
                        : "Roda de segunda a sexta-feira nos horários indicados."}
                    </span>
                  </div>
                </Show>

                <Show when={whenKind() === "interval"}>
                  <div class="flex items-center gap-2 pt-1">
                    <TextInputV2
                      class="!w-[90px]"
                      type="number"
                      value={intervalValue()}
                      onInput={(event) => setIntervalValue(event.currentTarget.value)}
                    />
                    <SelectV2
                      class="!w-[120px]"
                      options={["minutes", "hours"] as const}
                      current={intervalUnit()}
                      label={(unit) => (unit === "minutes" ? "minutos" : "horas")}
                      onSelect={(unit) => unit && setIntervalUnit(unit)}
                    />
                  </div>
                </Show>

                <Show when={whenKind() === "cron"}>
                  <div class="flex flex-col gap-1 pt-1">
                    <TextInputV2
                      class="w-full max-w-[280px]"
                      value={customCron()}
                      onInput={(event) => setCustomCron(event.currentTarget.value)}
                      placeholder="0 9 * * *"
                    />
                    <span class="text-12-regular text-text-weak">
                      Formato de 5 campos do cron: minuto hora dia mês dia-da-semana (ex: <code>0 9 * * 1-5</code>).
                    </span>
                  </div>
                </Show>
              </div>
            </div>

            {/* O que fazer */}
            <div class="flex min-w-0 flex-col gap-2 pt-1">
              <label class="text-12-medium text-v2-text-text-base font-semibold">
                O que você quer que essa rotina faça?
              </label>
              <Show
                when={!advanced()}
                fallback={
                  <TextInputV2
                    class="w-full min-w-0"
                    value={command()}
                    onInput={(event) => setCommand(event.currentTarget.value)}
                    placeholder="Comando de shell a executar (ex: git fetch && bun test)"
                  />
                }
              >
                <textarea
                  class={`
                    w-full min-h-[110px] rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3
                    text-13-regular text-v2-text-text-base placeholder:text-v2-text-text-muted outline-none
                    focus-visible:border-v2-border-border-focus focus-visible:ring-1 focus-visible:ring-v2-border-border-focus
                    leading-relaxed resize-y
                  `}
                  value={instructions()}
                  onInput={(event) => setInstructions(event.currentTarget.value)}
                  placeholder="Instruções em linguagem natural. Ex: Acesse os emails usando mcpmail, filtre os mais urgentes das últimas 2 horas e me notifique via izapia no WhatsApp com os pontos de ação."
                />
              </Show>
              <label class="flex items-center gap-2 text-12-regular text-text-weak cursor-pointer select-none pt-0.5">
                <SwitchV2 checked={advanced()} onChange={(checked) => setAdvanced(checked)} />
                Modo avançado: rodar um comando direto de shell em vez de instruções com IA
              </label>
            </div>

            {/* Configurações da Sessão / IA */}
            <Show when={!advanced()}>
              <div class="flex flex-col gap-4 border-t border-v2-border-border-base pt-4">
                {/* Pastas / Repositórios de Trabalho Múltiplos */}
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <label class="text-12-medium text-v2-text-text-base font-semibold">
                      Pastas / Repositórios de trabalho (opcional)
                    </label>
                    <span class="text-11-regular text-text-weak">
                      Adicione 1 ou mais pastas para comparar repositórios, inspecionar diffs ou ler planilhas
                    </span>
                  </div>

                  {/* Lista de pastas adicionadas */}
                  <Show when={workspaces().length > 0}>
                    <div class="flex flex-col gap-1.5 rounded-md bg-v2-background-bg-layer-01 p-2.5 border border-v2-border-border-base">
                      <For each={workspaces()}>
                        {(path, idx) => (
                          <div class="flex items-center justify-between gap-2 p-1.5 rounded bg-v2-background-bg-base border border-v2-border-border-base">
                            <div class="flex items-center gap-2 min-w-0">
                              <span class="text-11-medium px-1.5 py-0.5 rounded bg-v2-background-bg-layer-02 text-text-weak shrink-0">
                                Pasta {idx() + 1}
                              </span>
                              <span class="font-mono text-12-regular text-v2-text-text-base truncate">{path}</span>
                            </div>
                            <IconButtonV2
                              variant="ghost-muted"
                              aria-label="Remover pasta"
                              onClick={() => removeWorkspacePath(path)}
                              icon={<IconV2 name="close" size="small" />}
                            />
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Input de adição de pasta */}
                  <div class="flex items-center gap-2">
                    <TextInputV2
                      class="flex-1 min-w-0"
                      value={customPathInput()}
                      onInput={(event) => setCustomPathInput(event.currentTarget.value)}
                      placeholder="Caminho da pasta (ex: D:\dev\meu-projeto ou /home/repo)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addWorkspacePath(customPathInput())
                        }
                      }}
                    />
                    <ButtonV2
                      type="button"
                      variant="neutral"
                      disabled={!customPathInput().trim()}
                      onClick={() => addWorkspacePath(customPathInput())}
                    >
                      Adicionar
                    </ButtonV2>
                    <ButtonV2 type="button" variant="contrast" onClick={chooseDirectory}>
                      Selecionar pasta
                    </ButtonV2>
                  </div>
                </div>

                {/* Grid para Modelo de IA e Permissões */}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  {/* Modelo de IA */}
                  <div class="flex flex-col gap-1.5">
                    <label class="text-12-medium text-v2-text-text-base font-semibold">Modelo de IA</label>
                    <div class="w-full">
                      <ModelPickerV2
                        value={model()}
                        onChange={(val) => setModel(val)}
                        directory={workspaces()[0] || undefined}
                      />
                    </div>
                    <span class="text-11-regular text-text-weak">
                      Deixe padrão ou escolha um modelo/combo específico.
                    </span>
                  </div>

                  {/* Permissões */}
                  <div class="flex flex-col gap-1.5">
                    <label class="text-12-medium text-v2-text-text-base font-semibold">Permissões de Execução</label>
                    <div class="w-full">
                      <SelectV2
                        class="w-full"
                        options={["auto", "bypass", "default"] as const}
                        current={permissionMode()}
                        label={(mode) =>
                          mode === "auto"
                            ? "Automático (Executa sem travar)"
                            : mode === "bypass"
                              ? "Ignorar confirmações"
                              : "Padrão de configurações"
                        }
                        onSelect={(mode) => mode && setPermissionMode(mode)}
                      />
                    </div>
                    <span class="text-11-regular text-text-weak">
                      "Automático" permite que a IA execute as ferramentas sem depender de cliques manuais.
                    </span>
                  </div>
                </div>
              </div>

              {/* Ferramentas MCP / Conexões */}
              <div class="flex min-w-0 flex-col gap-3 border-t border-v2-border-border-border-base pt-4">
                <div class="flex items-center justify-between">
                  <div class="flex flex-col">
                    <label class="text-12-medium text-v2-text-text-base font-semibold">
                      Ferramentas e Conexões MCP
                    </label>
                    <span class="text-11-regular text-text-weak">
                      Selecione ferramentas de um ou mais serviços (ex: mcpmail + izapia). Se nada for marcado, todas as ferramentas conectadas ficam acessíveis.
                    </span>
                  </div>
                  <Show when={mcpTools().length > 0}>
                    <ButtonV2 type="button" variant="ghost-muted" onClick={() => setMcpTools([])}>
                      Limpar todas ({mcpTools().length})
                    </ButtonV2>
                  </Show>
                </div>

                {/* Abas dos MCP Servers Conectados */}
                <div class="flex flex-wrap items-center justify-between gap-2 bg-v2-background-bg-layer-01 p-1.5 rounded-md border border-v2-border-border-base">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <For each={mcpStatus() ?? []}>
                      {(serverName) => {
                        const count = () => mcpTools().filter((t) => t.server === serverName).length
                        const isSelected = () => selectedServer() === serverName
                        return (
                          <button
                            type="button"
                            class={`
                              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-12-medium transition-colors cursor-pointer border
                              ${
                                isSelected()
                                  ? "bg-v2-background-bg-base text-v2-text-text-base border-v2-border-border-strong font-semibold shadow-sm"
                                  : "text-text-weak border-transparent hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                              }
                            `}
                            onClick={() => setSelectedServer(serverName)}
                          >
                            <span>{serverName}</span>
                            <Show when={count() > 0}>
                              <span class="px-1.5 py-0.5 rounded-full bg-v2-state-bg-selected text-text-base text-11-medium font-bold">
                                {count()}
                              </span>
                            </Show>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                  <ButtonV2
                    type="button"
                    variant="neutral"
                    size="small"
                    class="h-7 text-12-medium"
                    onClick={openAddMcpModal}
                  >
                    <IconV2 name="plus" size="small" />
                    Adicionar conector MCP
                  </ButtonV2>
                </div>

                {/* Grade de Ferramentas do MCP Selecionado */}
                <Show when={selectedServer()}>
                  {(server) => (
                    <div class="flex flex-col gap-2.5 rounded-md bg-v2-background-bg-layer-01 p-3.5 border border-v2-border-border-base">
                      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-2">
                        <span class="text-12-medium text-v2-text-text-base font-semibold">
                          Ferramentas disponíveis em: <span class="text-v2-text-text-base font-mono">{server()}</span>
                        </span>
                        <div class="flex items-center gap-1.5">
                          <ButtonV2
                            type="button"
                            variant="ghost-muted"
                            size="small"
                            onClick={() => selectAllToolsForServer(server())}
                          >
                            Marcar todas
                          </ButtonV2>
                          <ButtonV2
                            type="button"
                            variant="ghost-muted"
                            size="small"
                            onClick={() => clearToolsForServer(server())}
                          >
                            Desmarcar
                          </ButtonV2>
                        </div>
                      </div>

                      <Show
                        when={!mcpCatalog.loading}
                        fallback={
                          <div class="flex items-center gap-2 py-3 text-12-regular text-text-weak">
                            <Spinner class="size-3.5 shrink-0" />
                            <span>Carregando catálogo de ferramentas, aguarde...</span>
                          </div>
                        }
                      >
                        <Show
                          when={(mcpCatalog() ?? []).length > 0}
                          fallback={<span class="text-12-regular text-text-weak py-2">Sem ferramentas disponíveis para este servidor.</span>}
                        >
                          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                            <For each={mcpCatalog()}>
                              {(tool) => {
                                const currentServer = server()
                                const checked = () =>
                                  mcpTools().some((t) => t.server === currentServer && t.tool === tool.name)
                                return (
                                  <button
                                    type="button"
                                    class={`
                                      flex flex-col items-start gap-1 p-2.5 rounded-md border text-left transition-all cursor-pointer
                                      ${
                                        checked()
                                          ? "border-v2-state-border-selected bg-v2-state-bg-selected text-text-base shadow-sm"
                                          : "border-v2-border-border-base bg-v2-background-bg-base text-text-weak hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-02"
                                      }
                                    `}
                                    onClick={() => toggleTool(currentServer, tool.name)}
                                  >
                                    <div class="flex items-center gap-2 w-full font-mono text-12-medium text-v2-text-text-base">
                                      <div
                                        class={`size-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                                          checked()
                                            ? "bg-v2-text-text-base text-v2-background-bg-base border-transparent"
                                            : "border-v2-border-border-base bg-v2-background-bg-base"
                                        }`}
                                      >
                                        <Show when={checked()}>
                                          <Icon name="check" size="small" />
                                        </Show>
                                      </div>
                                      <span class="truncate font-semibold">{tool.name}</span>
                                    </div>
                                    <Show when={tool.description}>
                                      <span class="text-11-regular text-text-weak line-clamp-2 pl-6 leading-relaxed">
                                        {tool.description}
                                      </span>
                                    </Show>
                                  </button>
                                )
                              }}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  )}
                </Show>

                {/* Resumo consolidado de todas as ferramentas selecionadas */}
                <Show when={mcpTools().length > 0}>
                  <div class="flex flex-col gap-1.5 pt-1">
                    <span class="text-12-medium text-text-weak">
                      Ferramentas ativas para esta rotina ({mcpTools().length}):
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={mcpTools()}>
                        {(t) => (
                          <Tag class="flex items-center gap-1 py-1 px-2 text-12-regular">
                            <span class="font-semibold text-text-weak">{t.server}/</span>
                            <span class="text-v2-text-text-base">{t.tool}</span>
                            <IconButtonV2
                              variant="ghost-muted"
                              aria-label="Remover"
                              onClick={() => toggleTool(t.server, t.tool)}
                              icon={<IconV2 name="close" size="small" />}
                            />
                          </Tag>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* Feedback do Resultado da Validação */}
          <Show when={testResult()}>
            {(result) => (
              <div
                class={`
                  flex flex-col gap-2 p-3.5 rounded-lg border text-13-regular
                  ${
                    result().success
                      ? "border-v2-state-border-selected bg-v2-state-bg-selected text-text-base"
                      : "border-v2-state-fg-danger bg-v2-background-bg-layer-01 text-v2-state-fg-danger"
                  }
                `}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 font-medium">
                    <Icon name={result().success ? "check" : "close"} size="small" />
                    <span>{result().success ? "Validação bem-sucedida!" : "Falha na validação"}</span>
                  </div>
                  <Show when={result().sessionId}>
                    <ButtonV2
                      variant="neutral"
                      size="small"
                      onClick={() => navigate(sessionHref(server.key, result().sessionId!))}
                    >
                      <Icon name="bubble-5" size="small" />
                      Inspecionar conversa do teste
                    </ButtonV2>
                  </Show>
                </div>
                <Show when={result().error}>
                  <p class="font-mono text-11-regular text-v2-state-fg-danger mt-1">
                    {result().error}
                  </p>
                </Show>
              </div>
            )}
          </Show>

          {/* Barra de Ações */}
          <div class="flex items-center justify-between gap-2.5 pt-2 pb-6">
            <ButtonV2
              variant="neutral"
              disabled={!canSave() || testMutation.isPending || createMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              <Icon name="terminal" size="small" />
              {testMutation.isPending ? "Validando rotina…" : "Validar rotina"}
            </ButtonV2>

            <div class="flex items-center gap-2">
              <ButtonV2 variant="neutral" onClick={() => navigate("/rotinas")}>
                Cancelar
              </ButtonV2>
              <ButtonV2
                variant="contrast"
                disabled={!canSave() || createMutation.isPending || testMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Salvando…" : isEditing() ? "Salvar alterações" : "Criar rotina"}
              </ButtonV2>
            </div>
          </div>
        </div>
      </ScrollView>
      </Show>
    </div>
  )
}
