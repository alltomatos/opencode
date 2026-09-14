import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import type { McpToolRef } from "./summary"

type WhenKind = "daily" | "interval" | "manual"
type IntervalUnit = "minutes" | "hours"

export const RoutineFormPage: Component = () => {
  const serverSDK = useServerSDK()
  const navigate = useNavigate()

  // Quando
  const [whenKind, setWhenKind] = createSignal<WhenKind>("daily")
  const [dailyTimes, setDailyTimes] = createSignal<string[]>(["09:00"])
  const [nextDailyTime, setNextDailyTime] = createSignal("13:00")
  const [intervalValue, setIntervalValue] = createSignal("30")
  const [intervalUnit, setIntervalUnit] = createSignal<IntervalUnit>("minutes")

  const addDailyTime = () => {
    const time = nextDailyTime()
    if (!time || dailyTimes().includes(time)) return
    setDailyTimes((prev) => [...prev, time].sort())
  }
  const removeDailyTime = (time: string) => setDailyTimes((prev) => prev.filter((t) => t !== time))

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

  const canSave = () => {
    if (whenKind() === "daily" && dailyTimes().length === 0) return false
    return advanced() ? command().trim().length > 0 : instructions().trim().length > 0
  }

  const createMutation = useMutation(() => ({
    mutationFn: async () => {
      const kind = whenKind()
      const action = advanced()
        ? ({ kind: "shell", command: command() } as const)
        : ({ kind: "skill", instructions: instructions(), mcpTools: mcpTools().length ? mcpTools() : undefined } as const)

      const triggers =
        kind === "daily"
          ? dailyTimes().map((time) => {
              const [h, m] = time.split(":").map((v) => Number(v) || 0)
              return { kind: "cron", expr: `${m} ${h} * * *` } as const
            })
          : kind === "interval"
            ? [
                {
                  kind: "interval",
                  ms: Math.max(1, Number(intervalValue()) || 0) * (intervalUnit() === "hours" ? 3_600_000 : 60_000),
                } as const,
              ]
            : [{ kind: "manual" } as const]

      // A recurring routine can fire more than once a day (e.g. 8h and 13h) --
      // each time becomes its own Schedule row sharing the same action, since
      // the backend's cron trigger is a single expression, not a list of times.
      await Promise.all(
        triggers.map((trigger) => serverSDK().client.v2.schedule.create({ scheduleCreateInput: { trigger, action } })),
      )
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
      <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-3 py-8 lg:px-6">
          <div class="flex items-center gap-3">
            <IconButtonV2
              variant="ghost-muted"
              aria-label="Voltar"
              onClick={() => navigate("/rotinas")}
              icon={<IconV2 name="close" size="small" />}
            />
            <h1 class="text-lg font-medium text-v2-text-text-base">Nova rotina</h1>
          </div>

          <div class="flex min-w-0 flex-col gap-4 rounded-md bg-v2-background-bg-layer-02 p-3">
            {/* Quando */}
            <div class="flex min-w-0 flex-col gap-2">
              <span class="text-12-medium text-text-weak">Quando</span>
              <div class="flex min-w-0 flex-col gap-2">
                <div class="flex items-center gap-1 rounded-md bg-v2-background-bg-layer-01 p-1 self-start">
                  <For
                    each={[
                      { value: "daily" as const, label: "Todo dia" },
                      { value: "interval" as const, label: "A cada" },
                      { value: "manual" as const, label: "Manual" },
                    ]}
                  >
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
                  <div class="flex flex-col gap-2">
                    <Show when={dailyTimes().length > 0}>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={dailyTimes()}>
                          {(time) => (
                            <Tag>
                              {time}
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
                      Adicione quantos horários quiser — ex: 08:00 e 13:00 pra rodar duas vezes ao dia.
                    </span>
                  </div>
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
                                  <Icon name="check" size="small" />
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
          </div>

          <div class="flex items-center justify-end gap-2">
            <ButtonV2 variant="neutral" onClick={() => navigate("/rotinas")}>
              Cancelar
            </ButtonV2>
            <ButtonV2
              variant="contrast"
              disabled={!canSave() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Criar rotina
            </ButtonV2>
          </div>
        </div>
      </ScrollView>
    </div>
  )
}
