import { Component, createSignal, createMemo, Show, For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useRoutinesQuery } from "@/pages/routines/routines-cache"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { showToast } from "@/utils/toast"

export const AgendaPage: Component = () => {
  const navigate = useNavigate()
  const language = useLanguage()
  const routines = useRoutinesQuery()

  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid")
  const [channelFilter, setChannelFilter] = createSignal<string>("all")
  const [statusFilter, setStatusFilter] = createSignal<"all" | "pending" | "completed">("all")
  const [currentDate, setCurrentDate] = createSignal(new Date())

  // Filtrar apenas rotinas que são Lembretes ou Agendamentos pontuais (trigger once ou action reminder)
  const agendaItems = createMemo(() => {
    return (routines.schedules() as any[]).filter((s: any) => {
      const isReminder = s.action?.kind === "reminder"
      const isOnce = s.trigger?.kind === "once"
      return isReminder || isOnce
    })
  })

  const filteredItems = createMemo(() => {
    return agendaItems().filter((item: any) => {
      // Filtro de canal
      if (channelFilter() !== "all") {
        const channels: string[] = item.action?.channels ?? ["desktop"]
        if (!channels.includes(channelFilter())) return false
      }
      // Filtro de status
      if (statusFilter() === "pending") {
        if (!item.enabled) return false
      } else if (statusFilter() === "completed") {
        if (item.enabled) return false
      }
      return true
    })
  })

  const cancelReminder = async (id: string) => {
    try {
      const client = routines.scheduleClient()
      if (!client) return
      await client.remove({ id })
      routines.invalidate()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("agenda.cancel"),
        description: "Lembrete cancelado com sucesso.",
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Funções de Calendário para Modo Grid
  const year = () => currentDate().getFullYear()
  const month = () => currentDate().getMonth()

  const monthName = () => {
    return currentDate().toLocaleString(language.locale() === "br" ? "pt-BR" : "en-US", {
      month: "long",
      year: "numeric",
    })
  }

  const prevMonth = () => {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  const today = () => {
    setCurrentDate(new Date())
  }

  // Gera dias do mês (grade de 35 a 42 células)
  const calendarDays = createMemo(() => {
    const y = year()
    const m = month()
    const firstDayIndex = new Date(y, m, 1).getDay()
    const totalDays = new Date(y, m + 1, 0).getDate()
    const prevMonthDays = new Date(y, m, 0).getDate()

    const days: { day: number; isCurrentMonth: boolean; dateKey: string }[] = []

    // Dias do mês anterior para completar primeira linha
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const dStr = `${m === 0 ? y - 1 : y}-${String(m === 0 ? 12 : m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      days.push({ day: d, isCurrentMonth: false, dateKey: dStr })
    }

    // Dias do mês atual
    for (let i = 1; i <= totalDays; i++) {
      const dStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`
      days.push({ day: i, isCurrentMonth: true, dateKey: dStr })
    }

    // Dias do próximo mês para completar grade
    const remaining = 35 - days.length > 0 ? 35 - days.length : 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      const dStr = `${m === 11 ? y + 1 : y}-${String(m === 11 ? 1 : m + 2).padStart(2, "0")}-${String(i).padStart(2, "0")}`
      days.push({ day: i, isCurrentMonth: false, dateKey: dStr })
    }

    return days
  })

  // Agrupa lembretes por data (YYYY-MM-DD)
  const itemsByDate = createMemo(() => {
    const map = new Map<string, any[]>()
    for (const item of filteredItems()) {
      let ts: number | undefined
      if (item.trigger?.kind === "once") ts = Number(item.trigger.timestamp)
      else if (item.lastRunAt) ts = Number(item.lastRunAt)

      if (!ts || isNaN(ts)) continue
      const date = new Date(ts)
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      const list = map.get(dateKey) ?? []
      list.push(item)
      map.set(dateKey, list)
    }
    return map
  })

  return (
    <div class="flex h-full w-full flex-col bg-v2-background-bg-base text-v2-text-text-primary">
      {/* Top Header */}
      <div class="flex shrink-0 items-center justify-between border-b border-v2-border-border-base px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="flex size-9 items-center justify-center rounded-[8px] bg-v2-background-bg-layer-02 border border-v2-border-border-faint text-v2-icon-icon-accent">
            <IconV2 name="calendar" size="normal" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-16-semibold">{language.t("agenda.title")}</h1>
              <span class="rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-medium text-v2-text-text-faint">
                {filteredItems().length}
              </span>
            </div>
            <p class="text-11-regular text-v2-text-text-faint">
              Lembretes e compromissos sincronizados com o AgentUI e canais de conversa
            </p>
          </div>
        </div>

        {/* Controles de Topo */}
        <div class="flex items-center gap-3">
          {/* Navegação de Mês (apenas no modo grid) */}
          <Show when={viewMode() === "grid"}>
            <div class="flex items-center gap-1.5 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1">
              <button
                type="button"
                onClick={prevMonth}
                class="rounded-[4px] px-2 py-1 text-12-medium text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-primary"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={today}
                class="rounded-[4px] px-2 py-1 text-12-medium text-v2-text-text-primary capitalize hover:bg-v2-background-bg-layer-02"
              >
                {monthName()}
              </button>
              <button
                type="button"
                onClick={nextMonth}
                class="rounded-[4px] px-2 py-1 text-12-medium text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-primary"
              >
                ▶
              </button>
            </div>
          </Show>

          {/* Filtro Canal */}
          <select
            class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-1.5 text-12-regular text-v2-text-text-base outline-none"
            value={channelFilter()}
            onChange={(e) => setChannelFilter(e.currentTarget.value)}
          >
            <option value="all">Canal: Todos</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="desktop">Desktop</option>
            <option value="agentui">AgentUI</option>
            <option value="telegram">Telegram</option>
          </select>

          {/* Filtro Status (apenas modo lista) */}
          <Show when={viewMode() === "list"}>
            <select
              class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-1.5 text-12-regular text-v2-text-text-base outline-none"
              value={statusFilter()}
              onChange={(e) => setStatusFilter(e.currentTarget.value as any)}
            >
              <option value="all">Status: {language.t("agenda.filter.all")}</option>
              <option value="pending">{language.t("agenda.filter.pending")}</option>
              <option value="completed">{language.t("agenda.filter.completed")}</option>
            </select>
          </Show>

          {/* Toggle Grid vs Lista */}
          <div class="flex items-center rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-0.5">
            <button
              type="button"
              class={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-12-medium transition-colors ${
                viewMode() === "grid"
                  ? "bg-v2-background-bg-layer-02 text-v2-text-text-primary shadow-sm"
                  : "text-v2-text-text-faint hover:text-v2-text-text-base"
              }`}
              onClick={() => setViewMode("grid")}
            >
              <span>▦</span>
              <span>{language.t("agenda.view.grid")}</span>
            </button>
            <button
              type="button"
              class={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-12-medium transition-colors ${
                viewMode() === "list"
                  ? "bg-v2-background-bg-layer-02 text-v2-text-text-primary shadow-sm"
                  : "text-v2-text-text-faint hover:text-v2-text-text-base"
              }`}
              onClick={() => setViewMode("list")}
            >
              <span>☰</span>
              <span>{language.t("agenda.view.list")}</span>
            </button>
          </div>

          {/* Criar Lembrete */}
          <ButtonV2
            variant="contrast"
            size="small"
            icon="plus"
            onClick={() => navigate("/rotinas/new")}
          >
            {language.t("agenda.new")}
          </ButtonV2>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div class="flex-1 overflow-y-auto p-6">
        {/* Modo 1: Calendário em Grid */}
        <Show when={viewMode() === "grid"}>
          <div class="flex flex-col rounded-[12px] border border-v2-border-border-base bg-v2-background-bg-layer-01 overflow-hidden shadow-sm">
            {/* Header dos Dias da Semana */}
            <div class="grid grid-cols-7 border-b border-v2-border-border-base bg-v2-background-bg-layer-02 text-center text-11-semibold text-v2-text-text-faint uppercase py-2">
              <div>Dom</div>
              <div>Seg</div>
              <div>Ter</div>
              <div>Qua</div>
              <div>Qui</div>
              <div>Sex</div>
              <div>Sáb</div>
            </div>

            {/* Células de Dias */}
            <div class="grid grid-cols-7 auto-rows-[120px] divide-x divide-y divide-v2-border-border-faint">
              <For each={calendarDays()}>
                {(cell) => {
                  const items = itemsByDate().get(cell.dateKey) ?? []
                  const isToday =
                    cell.dateKey ===
                    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`

                  return (
                    <div
                      class={`flex flex-col p-2 min-h-[120px] transition-colors ${
                        cell.isCurrentMonth ? "bg-v2-background-bg-layer-01" : "bg-v2-background-bg-base/40 opacity-50"
                      } ${isToday ? "ring-1 ring-inset ring-v2-blue-500/50" : ""}`}
                    >
                      <div class="flex items-center justify-between">
                        <span
                          class={`flex size-6 items-center justify-center rounded-full text-12-medium ${
                            isToday
                              ? "bg-v2-blue-600 text-white font-bold"
                              : cell.isCurrentMonth
                              ? "text-v2-text-text-primary"
                              : "text-v2-text-text-faint"
                          }`}
                        >
                          {cell.day}
                        </span>
                        <Show when={items.length > 0}>
                          <span class="text-10-regular text-v2-text-text-faint">{items.length} item(s)</span>
                        </Show>
                      </div>

                      {/* Lista de Eventos no Dia */}
                      <div class="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto">
                        <For each={items}>
                          {(item: any) => {
                            const channels: string[] = item.action?.channels ?? ["desktop"]
                            const isWhatsApp = channels.includes("whatsapp")
                            const date = new Date(item.trigger?.timestamp ?? item.lastRunAt ?? Date.now())
                            const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`

                            return (
                              <div
                                class={`group flex flex-col rounded-[6px] border p-1.5 text-11-medium transition-all hover:scale-[1.02] ${
                                  isWhatsApp
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                    : "border-v2-blue-500/30 bg-v2-blue-500/10 text-v2-blue-300"
                                }`}
                                title={item.action?.message ?? item.name}
                              >
                                <div class="flex items-center justify-between">
                                  <span class="text-10-medium opacity-80">{timeStr}</span>
                                  <span class="text-9-regular uppercase tracking-wider opacity-60">
                                    {isWhatsApp ? "WA" : "OS"}
                                  </span>
                                </div>
                                <span class="truncate font-semibold text-v2-text-text-primary">
                                  {item.action?.title ?? item.name}
                                </span>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Modo 2: Linha do Tempo / Lista */}
        <Show when={viewMode() === "list"}>
          <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <Show
              when={filteredItems().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-v2-border-border-base p-12 text-center">
                  <IconV2 name="calendar" size="large" class="opacity-40" />
                  <p class="text-13-regular text-v2-text-text-faint">{language.t("agenda.empty")}</p>
                </div>
              }
            >
              <For each={filteredItems()}>
                {(item: any) => {
                  const channels: string[] = item.action?.channels ?? ["desktop"]
                  const isWhatsApp = channels.includes("whatsapp")
                  const ts = Number(item.trigger?.timestamp ?? item.lastRunAt ?? Date.now())
                  const date = new Date(ts)
                  const dateFormatted = date.toLocaleString(language.locale() === "br" ? "pt-BR" : "en-US", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })

                  return (
                    <div class="flex items-start justify-between gap-4 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4 shadow-sm transition-all hover:border-v2-border-border-faint">
                      <div class="flex items-start gap-3.5">
                        <div
                          class={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[8px] text-16 ${
                            isWhatsApp ? "bg-emerald-500/20 text-emerald-400" : "bg-v2-blue-500/20 text-v2-blue-400"
                          }`}
                        >
                          {isWhatsApp ? "💬" : "⏰"}
                        </div>
                        <div class="flex flex-col gap-1">
                          <div class="flex items-center gap-2">
                            <h2 class="text-14-semibold text-v2-text-text-primary">
                              {item.action?.title ?? item.name}
                            </h2>
                            <span
                              class={`rounded-full px-2 py-0.5 text-10-medium ${
                                item.enabled
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {item.enabled ? "● Pendente" : "✓ Concluído"}
                            </span>
                          </div>
                          <Show when={item.action?.message}>
                            <p class="text-12-regular text-v2-text-text-faint line-clamp-2">
                              "{item.action.message}"
                            </p>
                          </Show>
                          <div class="mt-2 flex flex-wrap items-center gap-3 text-11-regular text-v2-text-text-faint">
                            <span>📅 {dateFormatted}</span>
                            <span>•</span>
                            <span>📱 Canais: {channels.join(", ")}</span>
                            <Show when={item.lastStatus}>
                              <span>•</span>
                              <span>Último Status: {item.lastStatus}</span>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="flex shrink-0 items-center gap-2">
                        <ButtonV2
                          variant="ghost-muted"
                          size="small"
                          onClick={() => cancelReminder(item.id)}
                        >
                          {language.t("agenda.cancel")}
                        </ButtonV2>
                      </div>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
export default AgendaPage
