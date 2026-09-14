import { createSignal, For, Show, type Component } from "solid-js"
import { createResource } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type WhenKind = "daily" | "interval" | "manual"
type IntervalUnit = "minutes" | "hours"
type McpToolRef = { server: string; tool: string }

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function triggerSummary(trigger: { kind: string; expr?: string; ms?: number | string }): string {
  if (trigger.kind === "cron") {
    const parts = String(trigger.expr ?? "").split(" ")
    if (parts.length === 5 && parts[0] !== "*" && parts[1] !== "*" && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
      return `Todo dia às ${pad(Number(parts[1]))}:${pad(Number(parts[0]))}`
    }
    return `cron: ${trigger.expr}`
  }
  if (trigger.kind === "interval") {
    const minutes = Math.round(Number(trigger.ms ?? 0) / 60_000)
    if (minutes % 60 === 0 && minutes > 0) return `A cada ${minutes / 60}h`
    return `A cada ${minutes}min`
  }
  return "Manual"
}

function actionSummary(action: {
  kind: string
  command?: string
  server?: string
  tool?: string
  instructions?: string
  mcpTools?: readonly McpToolRef[]
}): string {
  if (action.kind === "shell") return action.command ?? ""
  if (action.kind === "mcp_tool") return `${action.server}/${action.tool}`
  const tools = action.mcpTools?.length ? ` · usa ${action.mcpTools.map((t) => t.tool).join(", ")}` : ""
  return `${action.instructions ?? ""}${tools}`
}

export const SettingsScheduleV2: Component = () => {
  const serverSDK = useServerSDK()

  const [schedules, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.v2.schedule.list()
    return result.data ?? []
  })

  // Quando
  const [whenKind, setWhenKind] = createSignal<WhenKind>("daily")
  const [dailyTime, setDailyTime] = createSignal("09:00")
  const [intervalValue, setIntervalValue] = createSignal("30")
  const [intervalUnit, setIntervalUnit] = createSignal<IntervalUnit>("minutes")

  // Como
  const [advanced, setAdvanced] = createSignal(false)
  const [instructions, setInstructions] = createSignal("")
  const [command, setCommand] = createSignal("")

  // Por onde
  const [mcpTools, setMcpTools] = createSignal<McpToolRef[]>([])
  const [browseServer, setBrowseServer] = createSignal<string | undefined>(undefined)

  const [mcpServers] = createResource(async () => {
    const result = await serverSDK().client.mcp.status()
    return Object.entries(result.data ?? {})
      .filter(([, value]) => value.status === "connected")
      .map(([name]) => name)
  })

  const [mcpCatalog] = createResource(browseServer, async (name) => {
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

  const canSave = () => (advanced() ? command().trim().length > 0 : instructions().trim().length > 0)

  const reset = () => {
    setInstructions("")
    setCommand("")
    setMcpTools([])
  }

  const createMutation = useMutation(() => ({
    mutationFn: async () => {
      const kind = whenKind()
      const trigger =
        kind === "daily"
          ? (() => {
              const [h, m] = dailyTime().split(":").map((v) => Number(v) || 0)
              return { kind: "cron", expr: `${m} ${h} * * *` } as const
            })()
          : kind === "interval"
            ? ({
                kind: "interval",
                ms: Math.max(1, Number(intervalValue()) || 0) * (intervalUnit() === "hours" ? 3_600_000 : 60_000),
              } as const)
            : ({ kind: "manual" } as const)

      const action = advanced()
        ? ({ kind: "shell", command: command() } as const)
        : ({ kind: "skill", instructions: instructions(), mcpTools: mcpTools().length ? mcpTools() : undefined } as const)

      await serverSDK().client.v2.schedule.create({ scheduleCreateInput: { trigger, action } })
    },
    onSuccess: () => {
      reset()
      void refetch()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível salvar a rotina", description: message })
    },
  }))

  const runMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.run({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível rodar a rotina", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => serverSDK().client.v2.schedule.remove({ scheduleID: id }),
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível remover a rotina", description: message })
    },
  }))

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row flex items-center justify-between">
          <h2 class="settings-v2-tab-title">Rotinas</h2>
        </div>
      </div>
      <div class="settings-v2-tab-body settings-v2-models flex flex-col gap-4">
        <div class="flex min-w-0 flex-col gap-4 rounded-md bg-v2-background-bg-layer-02 p-3">
          {/* Quando */}
          <div class="flex min-w-0 flex-col gap-2">
            <span class="text-12-medium text-text-weak">Quando</span>
            <div class="flex min-w-0 flex-col gap-2">
              <div class="flex items-center gap-1 rounded-md bg-v2-background-bg-layer-01 p-1 self-start">
                <For each={[
                  { value: "daily" as const, label: "Todo dia" },
                  { value: "interval" as const, label: "A cada" },
                  { value: "manual" as const, label: "Manual" },
                ]}>
                  {(option) => (
                    <ButtonV2
                      type="button"
                      class="whitespace-nowrap"
                      variant={whenKind() === option.value ? "contrast" : "neutral"}
                      onClick={() => setWhenKind(option.value)}
                    >
                      {option.label}
                    </ButtonV2>
                  )}
                </For>
              </div>
              <Show when={whenKind() === "daily"}>
                <TextInputV2
                  class="!w-[110px]"
                  type="time"
                  value={dailyTime()}
                  onInput={(event) => setDailyTime(event.currentTarget.value)}
                />
              </Show>
              <Show when={whenKind() === "interval"}>
                <TextInputV2
                  class="!w-[80px]"
                  type="number"
                  value={intervalValue()}
                  onInput={(event) => setIntervalValue(event.currentTarget.value)}
                />
                <SelectV2
                  class="!w-[110px]"
                  options={["minutes", "hours"] as const}
                  current={intervalUnit()}
                  label={(unit) => (unit === "minutes" ? "minutos" : "horas")}
                  onSelect={(unit) => unit && setIntervalUnit(unit)}
                />
              </Show>
            </div>
          </div>

          {/* Como */}
          <div class="flex min-w-0 flex-col gap-2">
            <span class="text-12-medium text-text-weak">Como</span>
            <Show
              when={!advanced()}
              fallback={
                <TextInputV2
                  class="w-full min-w-0"
                  value={command()}
                  onInput={(event) => setCommand(event.currentTarget.value)}
                  placeholder="Comando de shell a executar"
                />
              }
            >
              <TextInputV2
                class="w-full min-w-0"
                value={instructions()}
                onInput={(event) => setInstructions(event.currentTarget.value)}
                placeholder="O que você quer que essa rotina faça? Ex: resuma as issues abertas e me avise"
              />
            </Show>
            <label class="flex items-center gap-2 text-12-regular text-text-weak">
              <SwitchV2 checked={advanced()} onChange={(checked) => setAdvanced(checked)} />
              Modo avançado: rodar um comando técnico em vez de descrever em texto
            </label>
          </div>

          {/* Por onde */}
          <Show when={!advanced()}>
            <div class="flex min-w-0 flex-col gap-2">
              <span class="text-12-medium text-text-weak">Por onde (opcional)</span>
              <span class="text-12-regular text-text-weak">Só aparecem ferramentas conectadas agora.</span>
              <SelectV2
                class="w-full min-w-0"
                options={mcpServers() ?? []}
                current={browseServer()}
                label={(name) => name}
                placeholder={mcpServers.loading ? "Carregando…" : "Escolher ferramenta conectada"}
                onSelect={(name) => setBrowseServer(name ?? undefined)}
              />
              <Show when={browseServer()}>
                <div class="flex flex-wrap gap-2 rounded-md bg-v2-background-bg-layer-01 p-2">
                  <Show
                    when={!mcpCatalog.loading}
                    fallback={<span class="text-12-regular text-text-weak">Carregando ferramentas…</span>}
                  >
                    <Show
                      when={(mcpCatalog() ?? []).length > 0}
                      fallback={<span class="text-12-regular text-text-weak">Sem ferramentas disponíveis.</span>}
                    >
                      <For each={mcpCatalog()}>
                        {(tool) => {
                          const server = browseServer()!
                          const checked = () => mcpTools().some((t) => t.server === server && t.tool === tool.name)
                          return (
                            <button
                              type="button"
                              class="flex items-center gap-1 rounded-full border px-2 py-1 text-12-regular"
                              classList={{
                                "border-v2-state-border-selected bg-v2-state-bg-selected text-text-base": checked(),
                                "border-v2-border-base text-text-weak": !checked(),
                              }}
                              onClick={() => toggleTool(server, tool.name)}
                            >
                              <Show when={checked()}>
                                <IconV2 name="check" size="small" />
                              </Show>
                              {tool.name}
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                  </Show>
                </div>
              </Show>
              <Show when={mcpTools().length > 0}>
                <div class="flex flex-wrap gap-1.5">
                  <For each={mcpTools()}>
                    {(t) => (
                      <Tag>
                        {t.server}/{t.tool}
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
              </Show>
            </div>
          </Show>

          <ButtonV2
            variant="neutral"
            icon="plus"
            class="!self-start"
            disabled={!canSave() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Criar rotina
          </ButtonV2>
        </div>

        <Show when={!schedules.loading} fallback={<div class="settings-v2-models-status">Carregando…</div>}>
          <Show
            when={(schedules() ?? []).length > 0}
            fallback={<div class="settings-v2-models-status">Nenhuma rotina ainda.</div>}
          >
            <SettingsListV2>
              <For each={schedules()}>
                {(item) => (
                  <SettingsRowV2
                    title={
                      <span class="flex items-center gap-2">
                        <IconV2 name="clock" size="small" />
                        {triggerSummary(item.trigger)}
                      </span>
                    }
                    description={
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="truncate">{actionSummary(item.action)}</span>
                        <Show when={item.lastStatus}>
                          <div class="flex items-center gap-2">
                            <Tag>{item.lastStatus}</Tag>
                            <Show when={item.lastError}>
                              <span class="truncate">{item.lastError}</span>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    <div class="flex items-center gap-1">
                      <IconButtonV2
                        variant="ghost-muted"
                        aria-label="Rodar agora"
                        disabled={runMutation.isPending}
                        onClick={() => runMutation.mutate(item.id)}
                        icon={<IconV2 name="play" size="small" />}
                      />
                      <IconButtonV2
                        variant="ghost-muted"
                        class="hover:text-v2-state-fg-danger focus-visible:text-v2-state-fg-danger"
                        aria-label="Remover"
                        onClick={() => removeMutation.mutate(item.id)}
                        icon={<IconV2 name="trash" size="small" />}
                      />
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </Show>
        </Show>
      </div>
    </>
  )
}
