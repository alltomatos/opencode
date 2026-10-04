import { Component, createSignal, createMemo, Show, For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useRoutinesQuery } from "@/pages/routines/routines-cache"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { showToast } from "@/utils/toast"

// Cores e estilos semânticos para cada canal de notificação
const CHANNEL_CONFIG: Record<string, { label: string; badge: string; bg: string; border: string; text: string; glow: string; dot: string; icon: string }> = {
  whatsapp: {
    label: "WhatsApp",
    badge: "WA",
    bg: "bg-emerald-500/10 hover:bg-emerald-500/15",
    border: "border-emerald-500/30 hover:border-emerald-500/50",
    text: "text-emerald-400",
    glow: "shadow-[0_0_12px_rgba(16,185,129,0.15)]",
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
    icon: "💬",
  },
  desktop: {
    label: "Desktop",
    badge: "OS",
    bg: "bg-sky-500/10 hover:bg-sky-500/15",
    border: "border-sky-500/30 hover:border-sky-500/50",
    text: "text-sky-400",
    glow: "shadow-[0_0_12px_rgba(14,165,233,0.15)]",
    dot: "bg-sky-400 shadow-[0_0_6px_rgba(14,165,233,0.6)]",
    icon: "💻",
  },
  agentui: {
    label: "AgentUI",
    badge: "AG",
    bg: "bg-purple-500/10 hover:bg-purple-500/15",
    border: "border-purple-500/30 hover:border-purple-500/50",
    text: "text-purple-300",
    glow: "shadow-[0_0_12px_rgba(168,85,247,0.15)]",
    dot: "bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.6)]",
    icon: "🤖",
  },
  telegram: {
    label: "Telegram",
    badge: "TG",
    bg: "bg-cyan-500/10 hover:bg-cyan-500/15",
    border: "border-cyan-500/30 hover:border-cyan-500/50",
    text: "text-cyan-300",
    glow: "shadow-[0_0_12px_rgba(6,182,212,0.15)]",
    dot: "bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)]",
    icon: "✈️",
  },
}

function getChannelStyle(channel: string) {
  return CHANNEL_CONFIG[channel] ?? CHANNEL_CONFIG.desktop
}

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

  const activeCount = createMemo(() => {
    return filteredItems().filter((item: any) => item.enabled).length
  })

  // Agrupamento ordenado para o Modo Lista / Timeline
  const timelineGroups = createMemo(() => {
    const map = new Map<string, { label: string; date: Date; items: any[] }>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const sorted = [...filteredItems()].sort((a, b) => {
      const tsA = Number(a.trigger?.timestamp ?? a.lastRunAt ?? 0)
      const tsB = Number(b.trigger?.timestamp ?? b.lastRunAt ?? 0)
      return tsA - tsB
    })

    for (const item of sorted) {
      const ts = Number(item.trigger?.timestamp ?? item.lastRunAt ?? Date.now())
      const d = new Date(ts)
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

      if (!map.has(dayKey)) {
        const itemDate = new Date(d)
        itemDate.setHours(0, 0, 0, 0)

        let label = ""
        if (itemDate.getTime() === today.getTime()) {
          label = language.t("agenda.today")
        } else if (itemDate.getTime() === tomorrow.getTime()) {
          label = language.t("agenda.tomorrow")
        } else if (itemDate.getTime() === yesterday.getTime()) {
          label = language.t("agenda.yesterday")
        } else {
          label = d.toLocaleDateString(language.locale() === "br" ? "pt-BR" : "en-US", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        }

        map.set(dayKey, { label, date: d, items: [] })
      }

      map.get(dayKey)!.items.push(item)
    }

    return Array.from(map.values())
  })

  return (
    <div class="flex h-full w-full flex-col bg-v2-background-bg-base text-v2-text-text-primary">
      {/* Top Header */}
      <div class="flex shrink-0 items-center justify-between border-b border-v2-border-border-base px-6 py-4 bg-v2-background-bg-base/80 backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <div class="relative flex size-10 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500/20 via-purple-500/15 to-transparent border border-purple-500/30 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <IconV2 name="calendar" size="normal" />
            <Show when={activeCount() > 0}>
              <span class="absolute -top-1 -right-1 flex size-2.5">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span class="relative inline-flex size-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </span>
            </Show>
          </div>
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-16-semibold tracking-tight text-v2-text-text-primary">{language.t("agenda.title")}</h1>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-500/25 px-2.5 py-0.5 text-11-medium text-purple-300">
                <span class="size-1.5 rounded-full bg-purple-400" />
                {language.t("agenda.activeCount", { count: activeCount() })}
              </span>
            </div>
            <p class="text-11-regular text-v2-text-text-faint mt-0.5">
              {language.t("agenda.subtitle")}
            </p>
          </div>
        </div>

        {/* Controles de Topo */}
        <div class="flex items-center gap-3">
          {/* Navegação de Mês (apenas no modo grid) */}
          <Show when={viewMode() === "grid"}>
            <div class="flex items-center gap-1 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1 shadow-sm">
              <button
                type="button"
                onClick={prevMonth}
                aria-label="Mês anterior"
                class="flex size-7 items-center justify-center rounded-[6px] text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-primary transition-colors"
              >
                <IconV2 name="chevron-left" size="small" />
              </button>
              <button
                type="button"
                onClick={today}
                class="rounded-[6px] px-2.5 py-1 text-12-semibold text-v2-text-text-primary capitalize hover:bg-v2-background-bg-layer-02 transition-colors"
              >
                {monthName()}
              </button>
              <button
                type="button"
                onClick={nextMonth}
                aria-label="Próximo mês"
                class="flex size-7 items-center justify-center rounded-[6px] text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-primary transition-colors"
              >
                <IconV2 name="chevron-right" size="small" />
              </button>
            </div>
          </Show>

          {/* Filtro Canal */}
          <div class="relative">
            <select
              class="appearance-none rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 pl-3 pr-8 py-1.5 text-12-medium text-v2-text-text-base outline-none hover:border-v2-border-border-faint focus:border-purple-500/50 transition-colors shadow-sm cursor-pointer"
              value={channelFilter()}
              onChange={(e) => setChannelFilter(e.currentTarget.value)}
            >
              <option value="all">{language.t("agenda.filter.channelAll")}</option>
              <option value="whatsapp">🟢 WhatsApp</option>
              <option value="desktop">💻 Desktop</option>
              <option value="agentui">🤖 AgentUI</option>
              <option value="telegram">✈️ Telegram</option>
            </select>
            <div class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-v2-text-text-faint">
              <IconV2 name="chevron-down" size="small" />
            </div>
          </div>

          {/* Filtro Status (apenas modo lista) */}
          <Show when={viewMode() === "list"}>
            <div class="relative">
              <select
                class="appearance-none rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 pl-3 pr-8 py-1.5 text-12-medium text-v2-text-text-base outline-none hover:border-v2-border-border-faint focus:border-purple-500/50 transition-colors shadow-sm cursor-pointer"
                value={statusFilter()}
                onChange={(e) => setStatusFilter(e.currentTarget.value as any)}
              >
                <option value="all">{language.t("agenda.filter.all")}</option>
                <option value="pending">⏳ {language.t("agenda.filter.pending")}</option>
                <option value="completed">✓ {language.t("agenda.filter.completed")}</option>
              </select>
              <div class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-v2-text-text-faint">
                <IconV2 name="chevron-down" size="small" />
              </div>
            </div>
          </Show>

          {/* Toggle Grid vs Lista */}
          <div class="flex items-center rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-0.5 shadow-sm">
            <button
              type="button"
              class={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-12-medium transition-all ${
                viewMode() === "grid"
                  ? "bg-v2-background-bg-layer-02 text-v2-text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.2)] font-semibold border border-v2-border-border-faint"
                  : "text-v2-text-text-faint hover:text-v2-text-text-primary hover:bg-v2-background-bg-layer-02/50"
              }`}
              onClick={() => setViewMode("grid")}
            >
              <IconV2 name="grid" size="small" />
              <span>{language.t("agenda.view.grid")}</span>
            </button>
            <button
              type="button"
              class={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-12-medium transition-all ${
                viewMode() === "list"
                  ? "bg-v2-background-bg-layer-02 text-v2-text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.2)] font-semibold border border-v2-border-border-faint"
                  : "text-v2-text-text-faint hover:text-v2-text-text-primary hover:bg-v2-background-bg-layer-02/50"
              }`}
              onClick={() => setViewMode("list")}
            >
              <IconV2 name="list" size="small" />
              <span>{language.t("agenda.view.list")}</span>
            </button>
          </div>

          {/* Criar Lembrete */}
          <button
            type="button"
            onClick={() => navigate("/rotinas/new")}
            class="flex items-center gap-1.5 rounded-[8px] bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3 py-1.5 text-12-semibold shadow-[0_2px_10px_rgba(124,58,237,0.3)] hover:shadow-[0_4px_16px_rgba(124,58,237,0.4)] transition-all cursor-pointer border border-purple-400/30"
          >
            <IconV2 name="plus" size="small" />
            <span>{language.t("agenda.new")}</span>
          </button>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div class="flex-1 overflow-y-auto p-6">
        {/* Modo 1: Calendário em Grid */}
        <Show when={viewMode() === "grid"}>
          <div class="flex flex-col rounded-[14px] border border-v2-border-border-base bg-v2-background-bg-layer-01 overflow-hidden shadow-lg">
            {/* Header dos Dias da Semana */}
            <div class="grid grid-cols-7 border-b border-v2-border-border-base bg-v2-background-bg-layer-02 text-center text-11-bold uppercase py-2.5 tracking-wider">
              <div class="text-rose-400/80">Dom</div>
              <div class="text-v2-text-text-faint">Seg</div>
              <div class="text-v2-text-text-faint">Ter</div>
              <div class="text-v2-text-text-faint">Qua</div>
              <div class="text-v2-text-text-faint">Qui</div>
              <div class="text-v2-text-text-faint">Sex</div>
              <div class="text-indigo-400/80">Sáb</div>
            </div>

            {/* Células de Dias */}
            <div class="grid grid-cols-7 auto-rows-[140px] divide-x divide-y divide-v2-border-border-faint/80">
              <For each={calendarDays()}>
                {(cell) => {
                  const items = itemsByDate().get(cell.dateKey) ?? []
                  const isToday =
                    cell.dateKey ===
                    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`

                  return (
                    <div
                      class={`group flex flex-col p-2.5 min-h-[140px] transition-colors relative ${
                        cell.isCurrentMonth
                          ? "bg-v2-background-bg-layer-01 hover:bg-v2-background-bg-layer-02/40"
                          : "bg-v2-background-bg-base/50 opacity-40 hover:opacity-75"
                      } ${isToday ? "ring-2 ring-inset ring-purple-500/60 bg-purple-500/[0.04]" : ""}`}
                    >
                      <div class="flex items-center justify-between">
                        <span
                          class={`flex size-7 items-center justify-center rounded-full text-12-medium transition-transform group-hover:scale-105 ${
                            isToday
                              ? "bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-bold shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                              : cell.isCurrentMonth
                              ? "text-v2-text-text-primary"
                              : "text-v2-text-text-faint"
                          }`}
                        >
                          {cell.day}
                        </span>
                        <Show when={items.length > 0}>
                          <span class="inline-flex items-center gap-1 rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 text-10-medium text-v2-text-text-faint border border-v2-border-border-faint">
                            <span class="size-1 rounded-full bg-purple-400" />
                            {items.length}
                          </span>
                        </Show>
                      </div>

                      {/* Lista de Eventos no Dia */}
                      <div class="mt-2 flex flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
                        <For each={items}>
                          {(item: any) => {
                            const channels: string[] = item.action?.channels ?? ["desktop"]
                            const primaryChannel = channels[0] ?? "desktop"
                            const cfg = getChannelStyle(primaryChannel)
                            const date = new Date(item.trigger?.timestamp ?? item.lastRunAt ?? Date.now())
                            const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`

                            return (
                              <div
                                class={`group/card flex flex-col rounded-[7px] border p-2 text-11-medium transition-all hover:scale-[1.02] cursor-pointer shadow-sm ${cfg.bg} ${cfg.border} ${cfg.glow}`}
                                title={item.action?.message ?? item.name}
                                onClick={() => navigate("/agenda")}
                              >
                                <div class="flex items-center justify-between gap-1 mb-1">
                                  <div class="flex items-center gap-1.5">
                                    <span class={`size-1.5 rounded-full ${item.enabled ? cfg.dot : "bg-neutral-500"}`} />
                                    <span class="font-mono text-10-semibold tracking-tight text-v2-text-text-primary">
                                      {timeStr}
                                    </span>
                                  </div>
                                  <span class={`rounded px-1.5 py-0.2 text-9-bold uppercase tracking-wider bg-black/30 border border-white/10 ${cfg.text}`}>
                                    {cfg.badge}
                                  </span>
                                </div>
                                <span class="truncate font-medium text-v2-text-text-primary text-11">
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

        {/* Modo 2: Linha do Tempo / Lista com Agrupamento */}
        <Show when={viewMode() === "list"}>
          <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
            <Show
              when={timelineGroups().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-v2-border-border-base bg-v2-background-bg-layer-01/50 p-16 text-center">
                  <div class="flex size-14 items-center justify-center rounded-2xl bg-v2-background-bg-layer-02 border border-v2-border-border-faint text-v2-text-text-faint/50">
                    <IconV2 name="calendar" size="large" />
                  </div>
                  <p class="text-14-medium text-v2-text-text-faint">{language.t("agenda.empty")}</p>
                </div>
              }
            >
              <For each={timelineGroups()}>
                {(group) => (
                  <div class="flex flex-col gap-3">
                    {/* Cabeçalho do Grupo de Data */}
                    <div class="flex items-center gap-3">
                      <div class="flex items-center gap-2">
                        <span class="size-2 rounded-full bg-purple-500" />
                        <h2 class="text-13-bold uppercase tracking-wider text-purple-300">
                          {group.label}
                        </h2>
                      </div>
                      <div class="h-px flex-1 bg-gradient-to-r from-purple-500/20 via-v2-border-border-base to-transparent" />
                      <span class="text-11-medium text-v2-text-text-faint">
                        {group.items.length} item(s)
                      </span>
                    </div>

                    {/* Cards do Grupo */}
                    <div class="flex flex-col gap-2.5">
                      <For each={group.items}>
                        {(item: any) => {
                          const channels: string[] = item.action?.channels ?? ["desktop"]
                          const primaryChannel = channels[0] ?? "desktop"
                          const cfg = getChannelStyle(primaryChannel)
                          const ts = Number(item.trigger?.timestamp ?? item.lastRunAt ?? Date.now())
                          const date = new Date(ts)
                          const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
                          const dateFormatted = date.toLocaleString(language.locale() === "br" ? "pt-BR" : "en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })

                          return (
                            <div class={`group flex items-start justify-between gap-4 rounded-[12px] border p-4.5 shadow-sm transition-all hover:scale-[1.008] ${cfg.bg} ${cfg.border} ${cfg.glow}`}>
                              <div class="flex items-start gap-4 flex-1 min-w-0">
                                {/* Ícone do Canal com Gradiente */}
                                <div class={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-[10px] text-20 bg-black/25 border border-white/10 ${cfg.glow}`}>
                                  {cfg.icon}
                                </div>

                                <div class="flex flex-col gap-1.5 flex-1 min-w-0">
                                  <div class="flex items-center gap-2.5 flex-wrap">
                                    <h3 class="text-14-semibold text-v2-text-text-primary tracking-tight">
                                      {item.action?.title ?? item.name}
                                    </h3>
                                    <span class={`rounded-full px-2.5 py-0.5 text-10-bold uppercase tracking-wider ${cfg.text} bg-black/20 border border-white/10`}>
                                      {cfg.label}
                                    </span>
                                    <span
                                      class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-10-medium ${
                                        item.enabled
                                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                          : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                      }`}
                                    >
                                      <span class={`size-1.5 rounded-full ${item.enabled ? "bg-amber-400" : "bg-emerald-400"}`} />
                                      {item.enabled ? language.t("agenda.filter.pending") : language.t("agenda.filter.completed")}
                                    </span>
                                  </div>

                                  <Show when={item.action?.message}>
                                    <p class="text-12-regular text-v2-text-text-faint/90 line-clamp-2 bg-black/20 rounded-md p-2 border border-white/5">
                                      "{item.action.message}"
                                    </p>
                                  </Show>

                                  <div class="mt-1 flex flex-wrap items-center gap-3 text-11-medium text-v2-text-text-faint">
                                    <span class="inline-flex items-center gap-1 font-mono text-v2-text-text-primary">
                                      <IconV2 name="clock" size="small" />
                                      {timeStr}
                                    </span>
                                    <span>•</span>
                                    <span>📅 {dateFormatted}</span>
                                    <span>•</span>
                                    <span>📱 {channels.map((c) => CHANNEL_CONFIG[c]?.label ?? c).join(", ")}</span>
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
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
export default AgendaPage
