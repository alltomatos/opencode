import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { createHomeController } from "@/pages/home/home-controller"
import { sessionHref } from "@/utils/session-route"
import { loadHomeSessionIndex } from "@/context/global-sync/home-session-index"
import { computeStats, formatDuration, formatMinutes, type StatsDateRange } from "./stats/stats-controller"

export const StatsPage: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const server = useServer()
  const tabs = useTabs()
  const home = createHomeController()
  const navigate = useNavigate()

  const [range, setRange] = createSignal<StatsDateRange>("all")
  const [selectedProject, setSelectedProject] = createSignal<string>("all")

  const [sessionsData, { refetch }] = createResource(async () => {
    const sdk = serverSDK()
    if (!sdk) return []
    try {
      const result = await loadHomeSessionIndex((input, options) => sdk.client.v2.session.list(input, options))
      return result.sessions
    } catch {
      return []
    }
  })

  const sessions = createMemo(() => sessionsData() ?? [])

  const stats = createMemo(() =>
    computeStats(sessions(), {
      range: range(),
      projectID: selectedProject(),
    }),
  )

  const numFmt = createMemo(() => new Intl.NumberFormat(language.intl()))
  const compactFmt = createMemo(() => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }))
  const usdFmt = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const openSession = (sessionID: string) => {
    const focusedConn = home.server.focused() ?? server.list.find((s) => ServerConnection.key(s) === server.key)
    if (!focusedConn) return
    const key = ServerConnection.key(focusedConn)
    tabs.addSessionTab({ server: key, sessionId: sessionID })
    navigate(sessionHref(key, sessionID))
  }

  // Token distribution calculations
  const totalBaseTokens = createMemo(() => {
    const s = stats()
    return s.inputTokens + s.outputTokens + s.reasoningTokens + s.cacheReadTokens
  })

  const pct = (val: number) => {
    const base = totalBaseTokens()
    if (base <= 0) return 0
    return Math.round((val / base) * 100)
  }

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-4 py-6 lg:px-8">
          {/* Header */}
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-v2-background-bg-layer-01 text-v2-icon-icon-base shadow-[var(--v2-elevation-raised)]">
                <IconV2 name="chart" size="large" class="size-6 text-v2-text-text-base" />
              </div>
              <div class="flex flex-col">
                <h1 class="text-lg font-medium text-v2-text-text-base">{language.t("stats.title")}</h1>
                <p class="text-12-regular text-v2-text-text-muted">{language.t("stats.description")}</p>
              </div>
            </div>

            {/* Actions: Range Picker + Refresh */}
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex h-8 items-center rounded-[8px] bg-v2-background-bg-layer-01 p-0.5 shadow-inner">
                <RangeButton
                  active={range() === "today"}
                  label={language.t("stats.filter.today")}
                  onClick={() => setRange("today")}
                />
                <RangeButton
                  active={range() === "7d"}
                  label={language.t("stats.filter.7d")}
                  onClick={() => setRange("7d")}
                />
                <RangeButton
                  active={range() === "30d"}
                  label={language.t("stats.filter.30d")}
                  onClick={() => setRange("30d")}
                />
                <RangeButton
                  active={range() === "all"}
                  label={language.t("stats.filter.all")}
                  onClick={() => setRange("all")}
                />
              </div>

              <IconButtonV2
                variant="ghost-muted"
                size="normal"
                icon={<Icon name="reset" />}
                aria-label={language.t("stats.refresh")}
                onClick={() => void refetch()}
              />
            </div>
          </div>

          {/* Project Filter if multiple projects exist */}
          <Show when={stats().breakdownByProject.length > 1}>
            <div class="flex flex-wrap items-center gap-1.5 text-12-regular">
              <span class="text-v2-text-text-faint">{language.t("stats.filter.project")}:</span>
              <button
                type="button"
                class="rounded-[6px] px-2 py-0.5 text-11-medium transition-colors"
                classList={{
                  "bg-v2-background-bg-layer-02 text-v2-text-text-base font-semibold": selectedProject() === "all",
                  "text-v2-text-text-muted hover:text-v2-text-text-base": selectedProject() !== "all",
                }}
                onClick={() => setSelectedProject("all")}
              >
                {language.t("stats.filter.project.all")}
              </button>
              <For each={stats().breakdownByProject}>
                {(proj) => (
                  <button
                    type="button"
                    class="rounded-[6px] px-2 py-0.5 text-11-medium transition-colors"
                    classList={{
                      "bg-v2-background-bg-layer-02 text-v2-text-text-base font-semibold": selectedProject() === proj.id,
                      "text-v2-text-text-muted hover:text-v2-text-text-base": selectedProject() !== proj.id,
                    }}
                    onClick={() => setSelectedProject(proj.id)}
                  >
                    {proj.name} ({proj.sessions})
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* KPI Summary Cards Grid */}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label={language.t("stats.kpi.totalTokens")}
              value={compactFmt().format(stats().totalTokens)}
              fullValue={numFmt().format(stats().totalTokens)}
              subtext={language.t("stats.kpi.totalTokens.sub")}
              accent="primary"
            />
            <KpiCard
              label={language.t("stats.kpi.outputTokens")}
              value={compactFmt().format(stats().outputTokens)}
              fullValue={numFmt().format(stats().outputTokens)}
              subtext={language.t("stats.kpi.outputTokens.sub")}
              badge={`${pct(stats().outputTokens)}%`}
              accent="purple"
            />
            <KpiCard
              label={language.t("stats.kpi.inputTokens")}
              value={compactFmt().format(stats().inputTokens)}
              fullValue={numFmt().format(stats().inputTokens)}
              subtext={language.t("stats.kpi.inputTokens.sub")}
              badge={`${pct(stats().inputTokens)}%`}
              accent="blue"
            />
            <KpiCard
              label={language.t("stats.kpi.reasoningTokens")}
              value={compactFmt().format(stats().reasoningTokens)}
              fullValue={numFmt().format(stats().reasoningTokens)}
              subtext={language.t("stats.kpi.reasoningTokens.sub")}
              badge={`${pct(stats().reasoningTokens)}%`}
              accent="amber"
            />
            <KpiCard
              label={language.t("stats.kpi.cacheTokens")}
              value={`${compactFmt().format(stats().cacheReadTokens)} / ${compactFmt().format(stats().cacheWriteTokens)}`}
              fullValue={`Read: ${numFmt().format(stats().cacheReadTokens)} | Write: ${numFmt().format(stats().cacheWriteTokens)}`}
              subtext={`${language.t("stats.kpi.cacheTokens.sub")}: ${stats().cacheRatio}%`}
              accent="emerald"
            />
            <KpiCard
              label={language.t("stats.kpi.totalCost")}
              value={usdFmt().format(stats().totalCost)}
              subtext={language.t("stats.kpi.totalCost.sub")}
              accent="rose"
            />
            <KpiCard
              label={language.t("stats.kpi.totalDuration")}
              value={formatDuration(stats().totalDurationMs)}
              fullValue={formatMinutes(stats().totalDurationMs, language.intl())}
              subtext={formatMinutes(stats().totalDurationMs, language.intl())}
              accent="blue"
            />
            <KpiCard
              label={language.t("stats.kpi.longestDuration")}
              value={formatDuration(stats().longestDurationMs)}
              fullValue={formatMinutes(stats().longestDurationMs, language.intl())}
              subtext={stats().longestSessionTitle ? `${stats().longestSessionTitle}` : language.t("stats.kpi.longestDuration.sub")}
              accent="amber"
            />
            <KpiCard
              label={language.t("stats.kpi.totalSessions")}
              value={numFmt().format(stats().totalSessions)}
              subtext={language.t("stats.kpi.totalSessions.sub")}
              accent="default"
            />
            <KpiCard
              label={language.t("stats.kpi.avgTokens")}
              value={compactFmt().format(stats().avgTokensPerSession)}
              fullValue={numFmt().format(stats().avgTokensPerSession)}
              subtext={`${formatDuration(stats().avgDurationMs)} / sessão`}
              accent="default"
            />
            <KpiCard
              label={language.t("stats.kpi.tps")}
              value={compactFmt().format(stats().tokensPerSecond)}
              fullValue={`${numFmt().format(stats().tokensPerSecond)} tokens/s`}
              subtext={language.t("stats.kpi.tps.sub")}
              accent="emerald"
            />
          </div>

          {/* Token Distribution Bar */}
          <div class="flex flex-col gap-2 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4 shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-13-medium text-v2-text-text-base">{language.t("stats.distribution.title")}</span>
              <span class="text-11-regular text-v2-text-text-muted">
                {numFmt().format(stats().totalTokens)} tokens
              </span>
            </div>

            {/* Stacked Proportional Bar */}
            <div class="flex h-3 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
              <div
                class="bg-blue-500 transition-all duration-300"
                style={{ width: `${pct(stats().inputTokens)}%` }}
                title={`${language.t("stats.distribution.input")}: ${pct(stats().inputTokens)}%`}
              />
              <div
                class="bg-purple-500 transition-all duration-300"
                style={{ width: `${pct(stats().outputTokens)}%` }}
                title={`${language.t("stats.distribution.output")}: ${pct(stats().outputTokens)}%`}
              />
              <div
                class="bg-amber-500 transition-all duration-300"
                style={{ width: `${pct(stats().reasoningTokens)}%` }}
                title={`${language.t("stats.distribution.reasoning")}: ${pct(stats().reasoningTokens)}%`}
              />
              <div
                class="bg-emerald-500 transition-all duration-300"
                style={{ width: `${pct(stats().cacheReadTokens)}%` }}
                title={`${language.t("stats.distribution.cache")}: ${pct(stats().cacheReadTokens)}%`}
              />
            </div>

            {/* Legend */}
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1 text-11-regular">
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-blue-500" />
                <span class="text-v2-text-text-muted">{language.t("stats.distribution.input")}</span>
                <span class="font-medium text-v2-text-text-base">{compactFmt().format(stats().inputTokens)}</span>
                <span class="text-v2-text-text-faint">({pct(stats().inputTokens)}%)</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-purple-500" />
                <span class="text-v2-text-text-muted">{language.t("stats.distribution.output")}</span>
                <span class="font-medium text-v2-text-text-base">{compactFmt().format(stats().outputTokens)}</span>
                <span class="text-v2-text-text-faint">({pct(stats().outputTokens)}%)</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-amber-500" />
                <span class="text-v2-text-text-muted">{language.t("stats.distribution.reasoning")}</span>
                <span class="font-medium text-v2-text-text-base">{compactFmt().format(stats().reasoningTokens)}</span>
                <span class="text-v2-text-text-faint">({pct(stats().reasoningTokens)}%)</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-emerald-500" />
                <span class="text-v2-text-text-muted">{language.t("stats.distribution.cache")}</span>
                <span class="font-medium text-v2-text-text-base">{compactFmt().format(stats().cacheReadTokens)}</span>
                <span class="text-v2-text-text-faint">({pct(stats().cacheReadTokens)}%)</span>
              </div>
            </div>
          </div>

          {/* Model & Agent Breakdowns Grid */}
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Models Card */}
            <div class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
              <span class="text-13-medium text-v2-text-text-base">{language.t("stats.breakdown.models")}</span>
              <div class="flex flex-col gap-2">
                <For
                  each={stats().breakdownByModel}
                  fallback={<span class="text-11-regular text-v2-text-text-faint">—</span>}
                >
                  {(m) => {
                    const share = stats().totalTokens > 0 ? Math.round((m.tokens / stats().totalTokens) * 100) : 0
                    return (
                      <div class="flex flex-col gap-1 rounded-[6px] bg-v2-background-bg-base p-2.5">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex min-w-0 items-center gap-2">
                            <Show when={m.providerID}>
                              <ProviderIcon id={m.providerID} class="size-3.5 shrink-0" />
                            </Show>
                            <span class="truncate text-12-medium text-v2-text-text-base">{m.name}</span>
                          </div>
                          <div class="flex shrink-0 items-center gap-2 text-11-regular">
                            <span class="font-medium text-v2-text-text-base">{compactFmt().format(m.tokens)}</span>
                            <span class="text-v2-text-text-faint">({share}%)</span>
                            <span class="text-v2-text-text-muted">{usdFmt().format(m.cost)}</span>
                          </div>
                        </div>
                        <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                          <div class="bg-purple-500" style={{ width: `${share}%` }} />
                        </div>
                        <div class="flex items-center justify-between text-10-regular text-v2-text-text-faint">
                          <span>
                            Out: {compactFmt().format(m.output)} | Reas: {compactFmt().format(m.reasoning)}
                          </span>
                          <span>{m.sessions} sessões</span>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* Agents Card */}
            <div class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
              <span class="text-13-medium text-v2-text-text-base">{language.t("stats.breakdown.agents")}</span>
              <div class="flex flex-col gap-2">
                <For
                  each={stats().breakdownByAgent}
                  fallback={<span class="text-11-regular text-v2-text-text-faint">—</span>}
                >
                  {(a) => {
                    const share = stats().totalTokens > 0 ? Math.round((a.tokens / stats().totalTokens) * 100) : 0
                    return (
                      <div class="flex flex-col gap-1 rounded-[6px] bg-v2-background-bg-base p-2.5">
                        <div class="flex items-center justify-between gap-2">
                          <span class="truncate text-12-medium text-v2-text-text-base">{a.name}</span>
                          <div class="flex shrink-0 items-center gap-2 text-11-regular">
                            <span class="font-medium text-v2-text-text-base">{compactFmt().format(a.tokens)}</span>
                            <span class="text-v2-text-text-faint">({share}%)</span>
                          </div>
                        </div>
                        <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                          <div class="bg-blue-500" style={{ width: `${share}%` }} />
                        </div>
                        <div class="flex items-center justify-between text-10-regular text-v2-text-text-faint">
                          <span>
                            Out: {compactFmt().format(a.output)} | Reas: {compactFmt().format(a.reasoning)}
                          </span>
                          <span>{a.sessions} sessões</span>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </div>

          {/* Sessions List Table */}
          <div class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
            <div class="flex items-center justify-between">
              <span class="text-13-medium text-v2-text-text-base">{language.t("stats.sessions.title")}</span>
              <span class="text-11-regular text-v2-text-text-muted">
                {stats().recentSessions.length} {language.t("stats.kpi.totalSessions")}
              </span>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-12-regular">
                <thead>
                  <tr class="border-b border-v2-border-border-base text-11-medium text-v2-text-text-faint">
                    <th class="pb-2">{language.t("stats.sessions.col.title")}</th>
                    <th class="pb-2">{language.t("stats.sessions.col.model")}</th>
                    <th class="pb-2 text-right">{language.t("stats.kpi.outputTokens")}</th>
                    <th class="pb-2 text-right">{language.t("stats.kpi.reasoningTokens")}</th>
                    <th class="pb-2 text-right">{language.t("stats.sessions.col.tokens")}</th>
                    <th class="pb-2 text-right">{language.t("stats.sessions.col.duration")}</th>
                    <th class="pb-2 text-right">{language.t("stats.sessions.col.cost")}</th>
                    <th class="pb-2 text-right">{language.t("stats.sessions.col.time")}</th>
                    <th class="pb-2 text-right"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-v2-border-border-muted">
                  <For
                    each={stats().recentSessions.slice(0, 30)}
                    fallback={
                      <tr>
                        <td colspan="9" class="py-6 text-center text-v2-text-text-muted">
                          {language.t("stats.sessions.empty")}
                        </td>
                      </tr>
                    }
                  >
                    {(s) => (
                      <tr class="group hover:bg-v2-background-bg-layer-02 transition-colors">
                        <td class="py-2.5 pr-2">
                          <div class="flex flex-col">
                            <span class="truncate font-medium text-v2-text-text-base max-w-[200px]" title={s.title}>
                              {s.title}
                            </span>
                            <span class="text-10-regular text-v2-text-text-faint truncate max-w-[180px]">
                              {s.projectName}
                            </span>
                          </div>
                        </td>
                        <td class="py-2.5 pr-2">
                          <div class="flex items-center gap-1.5 truncate max-w-[140px]">
                            <Show when={s.providerID}>
                              <ProviderIcon id={s.providerID} class="size-3 shrink-0" />
                            </Show>
                            <span class="truncate text-11-regular text-v2-text-text-muted" title={s.model}>
                              {s.model}
                            </span>
                          </div>
                        </td>
                        <td class="py-2.5 pr-2 text-right font-mono text-11-regular text-purple-400">
                          {compactFmt().format(s.output)}
                        </td>
                        <td class="py-2.5 pr-2 text-right font-mono text-11-regular text-amber-400">
                          {s.reasoning > 0 ? compactFmt().format(s.reasoning) : "—"}
                        </td>
                        <td class="py-2.5 pr-2 text-right font-mono text-11-medium text-v2-text-text-base">
                          {compactFmt().format(s.tokensTotal)}
                        </td>
                        <td class="py-2.5 pr-2 text-right font-mono text-11-medium text-blue-400" title={formatMinutes(s.durationMs, language.intl())}>
                          {s.durationFormatted}
                        </td>
                        <td class="py-2.5 pr-2 text-right font-mono text-11-regular text-v2-text-text-muted">
                          {usdFmt().format(s.cost)}
                        </td>
                        <td class="py-2.5 pr-2 text-right text-10-regular text-v2-text-text-faint">
                          {new Date(s.time).toLocaleDateString(language.intl(), { month: "short", day: "numeric" })}
                        </td>
                        <td class="py-2.5 text-right">
                          <button
                            type="button"
                            class="rounded-[4px] px-2 py-1 text-11-medium text-v2-text-text-muted hover:bg-v2-background-bg-base hover:text-v2-text-text-base transition-colors"
                            onClick={() => openSession(s.id)}
                          >
                            {language.t("stats.sessions.open")}
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </ScrollView>
    </div>
  )
}

function RangeButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-7 items-center rounded-[6px] px-2.5 text-11-medium transition-all"
      classList={{
        "bg-v2-background-bg-base font-semibold text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.active,
        "text-v2-text-text-muted hover:text-v2-text-text-base": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

function KpiCard(props: {
  label: string
  value: string
  fullValue?: string
  subtext: string
  badge?: string
  accent: "primary" | "purple" | "blue" | "amber" | "emerald" | "rose" | "default"
}) {
  return (
    <div class="flex flex-col justify-between gap-1 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div class="flex items-center justify-between gap-1">
        <span class="truncate text-11-medium text-v2-text-text-muted">{props.label}</span>
        <Show when={props.badge}>
          <span class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-10-medium text-v2-text-text-base">
            {props.badge}
          </span>
        </Show>
      </div>
      <div class="flex items-baseline gap-1.5" title={props.fullValue ?? props.value}>
        <span class="text-20-semibold tracking-tight text-v2-text-text-base">{props.value}</span>
      </div>
      <span class="truncate text-10-regular text-v2-text-text-faint">{props.subtext}</span>
    </div>
  )
}
