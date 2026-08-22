import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

export type PipelineStepStatus = "completed" | "in_progress" | "pending"

export interface PipelineIssue {
  id: string
  status: PipelineStepStatus
  /** The issue's own name (e.g. "E13.2 Exposição de Telemetria..."), not the skill slug — several
   * issues can share the same skill, so the skill can never be the display title. */
  title: string
  /** Extra context after the issue title (the "motivo" segment of the pipeline.md line), if any. */
  reason: string
  skillSlug?: string
  skillLabel?: string
}

export interface PipelinePhaseDefinition {
  id: string
  label: string
  skills: string[]
}

// Matches the skill catalog in packages/core/src/v1/config/batuta-skills.ts —
// kept as a small display-only map here since the frontend has no reason to
// import backend config just for a label lookup.
const SKILL_LABELS: Record<string, string> = {
  orchestrator: "Orchestrator",
  roadmap: "Roadmap",
  "setup-skills": "Setup Skills",
  "grill-with-docs": "Grill with Docs",
  "grill-feature-with-docs": "Grill Feature with Docs",
  "to-issues": "To Issues",
  "to-prd": "To PRD",
  diagnose: "Diagnose",
  tdd: "TDD",
  "query-docs": "Query Docs",
  "secure-e2e": "Secure E2E",
  e2e: "E2E",
  "qa-analyst": "QA Analyst",
  "improve-codebase-architecture": "Improve Architecture",
  prototype: "Prototype",
  "scaffold-mvp": "Scaffold MVP",
  "zoom-out": "Zoom Out",
  "write-a-skill": "Write a Skill",
  "grill-me": "Grill Me",
  handoff: "Handoff",
}

const STATUS_ALIASES: Record<string, PipelineStepStatus> = {
  completed: "completed",
  complete: "completed",
  done: "completed",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  progress: "in_progress",
  pending: "pending",
  todo: "pending",
  queued: "pending",
}

// Parses lines like "- [in_progress] tdd — E13.2 Implementar X — motivo da etapa"
// written by the orchestrator into pipeline.md (see batuta/index.ts's
// orchestratorInstructions). Tolerant of missing/extra "—" segments — worst
// case a line just becomes a pending issue with the raw text as its title.
export function parsePipeline(text: string): PipelineIssue[] {
  const issues: PipelineIssue[] = []
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith("-")) continue
    const match = /^-+\s*\[([^\]]+)\]\s*([\w.-]+)?\s*[—-]?\s*(.*)$/.exec(line)
    if (!match) continue
    const [, statusRaw, slug, rest] = match
    const status = STATUS_ALIASES[statusRaw.trim().toLowerCase()] ?? "pending"
    const dashIndex = rest.indexOf("—")
    const title = (dashIndex >= 0 ? rest.slice(0, dashIndex) : rest).trim() || line
    const reason = dashIndex >= 0 ? rest.slice(dashIndex + 1).trim() : ""
    issues.push({
      id: `${issues.length}-${slug ?? title}`,
      status,
      title,
      reason,
      skillSlug: slug,
      skillLabel: slug ? (SKILL_LABELS[slug] ?? slug) : undefined,
    })
  }
  return issues
}

// Parses the project's docs/batuta-pipeline.md — the Architect (or the user,
// editing it directly) defines the flow as "## Phase Name" headings each
// followed by a "- skill-slug" list. This is deliberately NOT a fixed
// 5-phase map: the whole point is that the Architect decides what fits the
// activity, and the user can rewrite it at any time.
export function parsePipelineDefinition(text: string): PipelinePhaseDefinition[] {
  const phases: PipelinePhaseDefinition[] = []
  let current: PipelinePhaseDefinition | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    if (heading) {
      const label = heading[1].trim()
      current = { id: label.toLowerCase().replace(/\s+/g, "-"), label, skills: [] }
      phases.push(current)
      continue
    }
    const item = /^-+\s*([\w.-]+)/.exec(line)
    if (item && current) current.skills.push(item[1])
  }
  return phases
}

export interface PipelinePhaseGroup {
  id: string
  label: string
  status: PipelineStepStatus
  issues: PipelineIssue[]
}

/** Buckets parsed issues into the phases defined in docs/batuta-pipeline.md, deriving each
 * phase's own status from its issues: pending if none started, completed if all did, else
 * in_progress. Issues whose skill isn't in any defined phase land in a trailing "other" group. */
export function groupByPhase(issues: PipelineIssue[], phaseDefs: PipelinePhaseDefinition[]): PipelinePhaseGroup[] {
  const skillToPhase = new Map<string, string>()
  for (const phase of phaseDefs) for (const skill of phase.skills) skillToPhase.set(skill, phase.id)

  const groups = phaseDefs.map((def) => ({
    id: def.id,
    label: def.label,
    issues: issues.filter((issue) => issue.skillSlug && skillToPhase.get(issue.skillSlug) === def.id),
  }))
  const bucketed = new Set(groups.flatMap((g) => g.issues.map((i) => i.id)))
  const leftover = issues.filter((issue) => !bucketed.has(issue.id))

  const withStatus = (label: string, id: string, phaseIssues: PipelineIssue[]): PipelinePhaseGroup => ({
    id,
    label,
    issues: phaseIssues,
    status:
      phaseIssues.length === 0
        ? "pending"
        : phaseIssues.every((issue) => issue.status === "completed")
          ? "completed"
          : phaseIssues.some((issue) => issue.status === "in_progress" || issue.status === "completed")
            ? "in_progress"
            : "pending",
  })

  const result = groups.map((g) => withStatus(g.label, g.id, g.issues))
  if (leftover.length) result.push(withStatus("—", "other", leftover))
  return result
}

export function usePipelineStages(props: { architectDone: boolean; orchestratorStarted: boolean }) {
  const language = useLanguage()
  return createMemo(() => [
    {
      id: "stage-architecture",
      status: (props.architectDone ? "completed" : "in_progress") as PipelineStepStatus,
      label: language.t("batuta.pipeline.stage.architecture"),
      detail: language.t("batuta.pipeline.stage.architecture.detail"),
    },
    {
      id: "stage-orchestration",
      status: (!props.orchestratorStarted ? "pending" : "completed") as PipelineStepStatus,
      label: language.t("batuta.pipeline.stage.orchestration"),
      detail: language.t("batuta.pipeline.stage.orchestration.detail"),
    },
  ])
}

function StatusIcon(props: { status: PipelineStepStatus; class?: string }) {
  const size = props.class ?? "size-5"
  if (props.status === "completed") return <Icon name="circle-check" class={`shrink-0 text-v2-state-fg-success ${size}`} />
  if (props.status === "in_progress")
    return (
      <span class={`flex shrink-0 items-center justify-center ${size}`}>
        <span class="size-3 animate-pulse rounded-full bg-v2-state-fg-info" />
      </span>
    )
  return (
    <span class={`flex shrink-0 items-center justify-center ${size}`}>
      <span class="size-3 rounded-full border-2 border-v2-icon-icon-muted" />
    </span>
  )
}

// Purely decorative hue cycle for the chevron bands (like a slide-deck
// process diagram) — independent of each phase's actual status.
const CHEVRON_COLORS = ["#2563eb", "#16a34a", "#d97706", "#0d9488", "#7c3aed", "#db2777", "#65a30d"]

/** Fixed stages (Arquitetura/Orquestração) + the phases defined in docs/batuta-pipeline.md,
 * stacked as compact chevrons — each expands to the real issues bucketed into that phase. */
export const PipelineVerticalList: Component<{
  architectDone: boolean
  orchestratorStarted: boolean
  pipelineText?: string
  pipelineDefinitionText?: string
}> = (props) => {
  const language = useLanguage()
  const stages = usePipelineStages(props)
  const phaseDefs = createMemo(() => parsePipelineDefinition(props.pipelineDefinitionText ?? ""))
  const phases = createMemo(() => groupByPhase(parsePipeline(props.pipelineText ?? ""), phaseDefs()))
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rows = createMemo(() => [
    ...stages().map((stage) => ({ id: stage.id, label: stage.label, status: stage.status, detail: stage.detail })),
    ...phases().map((phase) => ({
      id: phase.id,
      label: phase.label,
      status: phase.status,
      detail: undefined,
      issues: phase.issues,
    })),
  ])

  return (
    <div class="flex w-full flex-col items-stretch">
      <Show when={!phaseDefs().length}>
        <p class="mb-3 text-12-regular text-v2-text-text-muted">
          {language.t("batuta.pipeline.definition.missing")}
        </p>
      </Show>
      <For each={rows()}>
        {(row, index) => {
          const color = CHEVRON_COLORS[index() % CHEVRON_COLORS.length]
          const isOpen = () => expanded().has(row.id)
          const issues = "issues" in row ? row.issues : undefined
          return (
            <div class="flex flex-col">
              <button
                type="button"
                class="relative flex min-h-[40px] w-full items-center gap-2.5 px-5 py-2 text-left"
                style={{
                  background: color,
                  "clip-path": "polygon(0 0, 100% 0, 100% calc(100% - 12px), 50% 100%, 0 calc(100% - 12px))",
                  "margin-bottom": "-9px",
                  "padding-bottom": "18px",
                }}
                onClick={() => toggle(row.id)}
              >
                <StatusIcon status={row.status} class="size-4 !text-white" />
                <span class="flex-1 truncate text-13-medium text-white">{row.label}</span>
                <Show when={issues}>
                  {(list) => (
                    <span class="text-11-regular text-white/80">
                      {list().filter((i) => i.status === "completed").length}/{list().length}
                    </span>
                  )}
                </Show>
                <Icon
                  name="chevron-down"
                  class="size-3.5 shrink-0 text-white/80 transition-transform"
                  classList={{ "rotate-180": isOpen() }}
                />
              </button>
              <Show when={isOpen()}>
                <div class="mt-3 mb-1 flex flex-col gap-1.5 rounded-md bg-v2-background-bg-layer-01 p-3">
                  <Show when={row.detail}>
                    <p class="text-12-regular text-v2-text-text-muted">{row.detail}</p>
                  </Show>
                  <Show when={issues}>
                    {(list) => (
                      <Show
                        when={list().length}
                        fallback={
                          <p class="text-12-regular text-v2-text-text-muted">
                            {language.t("batuta.pipeline.kanban.empty")}
                          </p>
                        }
                      >
                        <For each={list()}>
                          {(issue) => (
                            <div class="flex items-start gap-2 rounded-md border border-v2-border-border-base p-2">
                              <StatusIcon status={issue.status} class="mt-0.5 size-3.5" />
                              <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-12-medium text-v2-text-text-base">{issue.title}</span>
                                <Show when={issue.reason}>
                                  <span class="text-11-regular text-v2-text-text-muted">{issue.reason}</span>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </Show>
                    )}
                  </Show>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}

const KANBAN_COLUMNS: { status: PipelineStepStatus; labelKey: string }[] = [
  { status: "pending", labelKey: "batuta.pipeline.kanban.pending" },
  { status: "in_progress", labelKey: "batuta.pipeline.kanban.inProgress" },
  { status: "completed", labelKey: "batuta.pipeline.kanban.completed" },
]

function KanbanCard(props: { issue: PipelineIssue }) {
  const [expanded, setExpanded] = createSignal(false)
  return (
    <button
      type="button"
      class="flex w-full flex-col gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-2.5 text-left"
      onClick={() => setExpanded((current) => !current)}
    >
      <div class="flex items-center gap-1.5">
        <StatusIcon status={props.issue.status} class="size-3.5" />
        <span class="flex-1 truncate text-12-medium text-v2-text-text-base">{props.issue.title}</span>
      </div>
      <Show when={props.issue.skillLabel}>
        <span class="w-fit rounded bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-11-regular text-v2-text-text-muted">
          {props.issue.skillLabel}
        </span>
      </Show>
      <Show when={props.issue.reason}>
        <p classList={{ truncate: !expanded() }} class="text-11-regular text-v2-text-text-muted">
          {props.issue.reason}
        </p>
      </Show>
    </button>
  )
}

/** The parsed pipeline.md issues laid out as a 3-column board — Arquitetura/Orquestração
 * are sequential stages, not board cards, so they're shown as a fixed strip above it. */
export const PipelineKanban: Component<{
  architectDone: boolean
  orchestratorStarted: boolean
  pipelineText?: string
}> = (props) => {
  const language = useLanguage()
  const stages = usePipelineStages(props)
  const issues = createMemo(() => parsePipeline(props.pipelineText ?? ""))
  const byStatus = (status: PipelineStepStatus) => issues().filter((issue) => issue.status === status)

  return (
    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap gap-4">
        <For each={stages()}>
          {(stage) => (
            <div class="flex items-center gap-1.5 text-12-regular text-v2-text-text-muted">
              <StatusIcon status={stage.status} class="size-3.5" />
              {stage.label}
            </div>
          )}
        </For>
      </div>
      <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <For each={KANBAN_COLUMNS}>
          {(column) => (
            <div class="flex min-w-0 flex-col gap-2 rounded-[10px] bg-v2-background-bg-layer-01 p-2.5">
              <div class="flex items-center gap-1.5 px-1">
                <span class="text-11-medium uppercase tracking-wide text-v2-text-text-muted">
                  {language.t(column.labelKey as never)}
                </span>
                <span class="text-11-regular text-v2-text-text-muted">({byStatus(column.status).length})</span>
              </div>
              <div class="flex flex-col gap-2">
                <For each={byStatus(column.status)}>{(issue) => <KanbanCard issue={issue} />}</For>
                <Show when={byStatus(column.status).length === 0}>
                  <p class="px-1 text-11-regular text-v2-text-text-muted">
                    {language.t("batuta.pipeline.kanban.empty")}
                  </p>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
