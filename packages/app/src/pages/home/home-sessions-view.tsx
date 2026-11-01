import type { Session } from "@opencode-ai/sdk/v2/client"
import { type Accessor, createMemo, For, Show, Suspense } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { SessionTabAvatarView } from "@/pages/layout/session-tab-avatar"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { getRelativeTime } from "@/utils/time"
import { computeStats, formatDuration } from "@/pages/stats/stats-controller"
import { DialogImportSession } from "@/components/dialog-import-session"
import { shouldOpenSessionInBackground } from "../home-session-open"
import {
  HomeSessionStatusController,
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type HomeSessionsLayoutMode,
  type OpenSessionOptions,
} from "./home-sessions-controller"

const SHOW_HOME_SESSION_ARCHIVE = true
const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"
const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: Accessor<HomeSessionGroup[]>
  records?: Accessor<HomeSessionRecord[]>
  allSessions?: Accessor<Session[]>
  selectedProject?: Accessor<LocalProject | undefined>
  onRefetchSessions?: () => void
  showProjectName: Accessor<boolean>
  viewMode?: Accessor<HomeSessionsLayoutMode>
  onSetViewMode?: (mode: HomeSessionsLayoutMode) => void
  server: Accessor<ServerConnection.Key>
  canCreateSession: Accessor<boolean>
  searchValue: Accessor<string>
  searchPlaceholder: Accessor<string>
  searchOpen: Accessor<boolean>
  searchLoading: Accessor<boolean>
  searchResults: Accessor<HomeSessionRecord[]>
  searchActive: Accessor<string>
  searchNoResultsLabel: Accessor<string>
  titleOpacity: (id: HomeSessionGroup["id"]) => number
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onOpenSession: (session: Session, options?: OpenSessionOptions) => void
  onArchiveSession: (session: Session) => Promise<void>
  onSetHoverTarget: (element: HTMLElement) => void
  onSetThumbTrack: (element: HTMLDivElement) => void
  onSetContent: (element: HTMLDivElement) => void
  onSetHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => void
  onWheel: (event: WheelEvent) => void
  onSetSearchRoot: (element: HTMLDivElement) => void
  onSetSearchInput: (element: HTMLInputElement) => void
  onSetSearchList: (element: HTMLDivElement) => void
  onSearchFocus: () => void
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

export function HomeSessionsView(props: HomeSessionsViewProps) {
  const dialog = useDialog()
  const numFmt = createMemo(() => new Intl.NumberFormat(props.language.intl()))
  const compactFmt = createMemo(
    () => new Intl.NumberFormat(props.language.intl(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const currentProjectSessions = createMemo(() => {
    const list = props.records?.() ?? []
    return list.map((r) => r.session)
  })

  const projectStats = createMemo(() => {
    return computeStats(currentProjectSessions(), { range: "all" })
  })

  const tokensPerMinute = createMemo(() => {
    const s = projectStats()
    if (s.totalDurationMs <= 0) return 0
    const minutes = s.totalDurationMs / 60000
    return Math.round(s.totalTokens / minutes)
  })

  const openImportDialog = () => {
    const proj = props.selectedProject?.()
    dialog.push(() => (
      <DialogImportSession
        directory={proj?.worktree}
        projectName={proj ? displayName(proj) : undefined}
        onImportComplete={() => props.onRefetchSessions?.()}
      />
    ))
  }

  return (
    <section
      ref={props.onSetHoverTarget}
      class="min-h-0 min-w-0 flex-1 flex flex-col"
      aria-label={props.language.t("sidebar.project.recentSessions")}
    >
      <div class="sticky top-0 z-30 shrink-0 bg-v2-background-bg-base pb-3 pt-4 lg:pt-8" onWheel={props.onWheel}>
        {/* Cabeçalho do Projeto & KPIs */}
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-v2-border-border-base pb-3.5">
          <div class="flex items-center gap-3 min-w-0">
            <Show
              when={props.selectedProject?.()}
              fallback={
                <div class="flex items-center gap-2.5">
                  <div class="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-v2-background-bg-layer-02 text-v2-text-text-muted">
                    <Icon name="folder" size="small" />
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="truncate text-15-semibold text-v2-text-text-base">
                      {props.language.t("project.kpi.allProjects")}
                    </span>
                  </div>
                </div>
              }
            >
              {(project) => (
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="shrink-0 size-7">
                    <ProjectAvatar
                      fallback={displayName(project())}
                      src={getProjectAvatarSource(project().id, project().icon)}
                      variant={getProjectAvatarVariant(project().icon?.color)}
                    />
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="truncate text-15-semibold text-v2-text-text-base leading-tight">
                      {displayName(project())}
                    </span>
                    <span class="truncate text-11-regular text-v2-text-text-faint font-mono">
                      {project().worktree}
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </div>

          {/* KPIs do Projeto & Botão de Importação */}
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1.5 rounded-[8px] bg-v2-background-bg-layer-01 p-1 border border-v2-border-border-base text-11-regular">
              {/* Horas gastas */}
              <div class="flex items-center gap-1.5 px-2 py-0.5">
                <span class="text-v2-text-text-muted">{props.language.t("project.kpi.hoursSpent")}:</span>
                <span class="font-medium text-v2-text-text-base">
                  {formatDuration(projectStats().totalDurationMs)}
                </span>
              </div>
              <div class="h-3.5 w-px bg-v2-border-border-base" />

              {/* Tokens Totais */}
              <div class="flex items-center gap-1.5 px-2 py-0.5">
                <span class="text-v2-text-text-muted">{props.language.t("project.kpi.totalTokens")}:</span>
                <span class="font-medium text-v2-text-text-base" title={`${numFmt().format(projectStats().totalTokens)} tokens`}>
                  {compactFmt().format(projectStats().totalTokens)}
                </span>
              </div>
              <div class="h-3.5 w-px bg-v2-border-border-base" />

              {/* Média Tokens / Min */}
              <div class="flex items-center gap-1.5 px-2 py-0.5">
                <span class="text-v2-text-text-muted">{props.language.t("project.kpi.tokensPerMinute")}:</span>
                <span class="font-medium text-v2-text-text-base">
                  {compactFmt().format(tokensPerMinute())}
                </span>
              </div>
            </div>

            {/* Botão Importar Sessão */}
            <ButtonV2
              variant="outline"
              size="normal"
              class="shrink-0 h-8 px-2.5 [font-weight:500] text-12-regular"
              onClick={openImportDialog}
            >
              <Icon name="arrow-down-to-line" size="small" class="mr-1.5" />
              {props.language.t("project.import.button")}
            </ButtonV2>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <HomeSessionSearch {...props} />
          </div>
          <Show when={props.viewMode && props.onSetViewMode}>
            <div class="home-sessions-view-toggle shrink-0" role="group" aria-label={props.language.t("sidebar.project.recentSessions")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                aria-label={props.language.t("settings.providers.view.grid")}
                aria-pressed={props.viewMode!() === "grid"}
                classList={{ "home-sessions-view-toggle-active": props.viewMode!() === "grid" }}
                icon={<IconV2 name="grid" size="small" />}
                onClick={() => props.onSetViewMode!("grid")}
              />
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                aria-label={props.language.t("settings.providers.view.list")}
                aria-pressed={props.viewMode!() === "list"}
                classList={{ "home-sessions-view-toggle-active": props.viewMode!() === "list" }}
                icon={<IconV2 name="list" size="small" />}
                onClick={() => props.onSetViewMode!("list")}
              />
            </div>
          </Show>
          <Suspense>
            <Show when={props.canCreateSession()}>
              <ButtonV2
                data-action="home-new-session"
                variant="neutral"
                size="normal"
                icon="edit"
                class="shrink-0 h-9 px-3 [font-weight:530]"
                onClick={props.onCreateSession}
              >
                {props.language.t("command.session.new")}
              </ButtonV2>
            </Show>
          </Suspense>
        </div>
      </div>
      <div class="pointer-events-none sticky top-[84px] z-40 h-0 -mr-3 lg:top-[108px]">
        <div
          ref={props.onSetThumbTrack}
          data-component="home-session-scroll-track"
          class="relative ml-auto h-[calc(100cqh-84px)] w-3 lg:h-[calc(100cqh-108px)]"
        />
      </div>
      <div class="-mr-3 min-h-[calc(100cqh-72px)] lg:min-h-[calc(100cqh-96px)]">
        <Suspense
          fallback={
            <div class="pt-3">
              <HomeSessionSkeleton label={props.language.t("common.loading")} />
            </div>
          }
        >
          <Show
            when={props.groups().length > 0}
            fallback={
              <HomeSessionsEmpty
                onNewSession={props.canCreateSession() ? props.onCreateSession : undefined}
                language={props.language}
              />
            }
          >
            <div ref={props.onSetContent} class="flex flex-col pt-3 pr-3 pb-16">
              <For each={props.groups()}>
                {(group, index) => (
                  <>
                    <HomeSessionGroupHeader
                      title={group.title}
                      count={group.sessions.length}
                      titleOpacity={props.titleOpacity(group.id)}
                      onSetRef={(element) => props.onSetHeader(group.id, element)}
                      elevated={index() === 0}
                    />
                    <Show
                      when={props.viewMode ? props.viewMode() === "grid" : true}
                      fallback={
                        <div
                          class={`flex min-w-0 flex-col gap-1.5 pt-4 ${index() === props.groups().length - 1 ? "" : "mb-8"}`}
                        >
                          <For each={group.sessions}>{(record) => <HomeSessionRow {...props} record={record} />}</For>
                        </div>
                      }
                    >
                      <div
                        class={`grid min-w-0 grid-cols-1 gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
                          index() === props.groups().length - 1 ? "" : "mb-8"
                        }`}
                      >
                        <For each={group.sessions}>{(record) => <HomeSessionCard {...props} record={record} />}</For>
                      </div>
                    </Show>
                  </>
                )}
              </For>
            </div>
          </Show>
        </Suspense>
      </div>
    </section>
  )
}

function HomeSessionLeadingController(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
  revealProjectOnHover: boolean
  render?: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => any
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) =>
        props.render ? (
          props.render(state)
        ) : (
          <HomeSessionLeading
            record={props.record}
            revealProjectOnHover={props.revealProjectOnHover}
            open={state.open()}
            unread={state.unread()}
            loading={state.loading()}
          />
        )
      }
    />
  )
}

function HomeSessionLeading(props: {
  record: HomeSessionRecord
  revealProjectOnHover: boolean
  open: boolean
  unread: boolean
  loading: boolean
}) {
  return (
    <div class="relative shrink-0">
      <Show when={props.open}>
        <span
          aria-hidden="true"
          class={`
            pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2
            rounded-[2px] bg-v2-background-bg-layer-04
          `}
          style={{ right: "calc(100% + 4px)" }}
        />
      </Show>
      <SessionTabAvatarView
        project={props.record.project}
        directory={props.record.session.directory}
        revealProjectOnHover={props.revealProjectOnHover}
        unread={props.unread}
        loading={props.loading}
      />
    </div>
  )
}

function HomeSessionSearch(props: HomeSessionsViewProps) {
  return (
    <div class="w-full">
      <div ref={props.onSetSearchRoot} data-component="home-session-search" class="relative z-30 w-full">
        <Show when={props.searchOpen()}>
          <div
            data-component="home-session-search-panel"
            class={`
              absolute flex flex-col overflow-hidden rounded-[12px]
              bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]
            `}
            style={{ top: "-6px", left: "-6px", width: "calc(100% + 12px)" }}
          >
            <div class="flex flex-col pt-9">
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4">
                <Show
                  when={!props.searchLoading()}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Spinner class="size-4" />
                    </div>
                  }
                >
                  <Show
                    when={props.searchResults().length > 0}
                    fallback={
                      <p
                        class={`
                          my-1.5 px-4 pb-2 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.searchNoResultsLabel()}
                      </p>
                    }
                  >
                    <div class="flex flex-col">
                      <p
                        class={`
                          my-1.5 pl-[18px] pr-6 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.language.t("home.sessions.search.sessions")}
                      </p>
                      <ScrollView class="max-h-80" viewportRef={props.onSetSearchList}>
                        <div class="flex flex-col gap-px pb-2">
                          <For each={props.searchResults()}>
                            {(record) => (
                              <HomeSessionSearchResultRow
                                {...props}
                                record={record}
                                selected={props.searchActive() === homeSessionSearchKey(record)}
                              />
                            )}
                          </For>
                        </div>
                      </ScrollView>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class={`
            relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 pl-3 pr-2
            bg-v2-background-bg-layer-02/60 text-v2-icon-icon-muted transition-[background-color,box-shadow]
            duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-within:bg-v2-background-bg-layer-02
          `}
        >
          <IconV2 name="magnifying-glass" />
          <input
            ref={props.onSetSearchInput}
            class={`
              relative z-20 min-w-0 flex-1 border-0 bg-transparent outline-0
              text-v2-text-text-base [font-weight:440] placeholder:text-v2-text-text-faint
            `}
            value={props.searchValue()}
            placeholder={props.searchPlaceholder()}
            aria-label={props.searchPlaceholder()}
            aria-expanded={props.searchOpen()}
            aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              props.searchActive() && props.searchOpen()
                ? `home-session-search-option-${props.searchActive()}`
                : undefined
            }
            onFocus={props.onSearchFocus}
            onInput={(event) => props.onSearchInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onSearchClose()
                event.currentTarget.blur()
                return
              }
              if (!props.searchOpen() || props.searchResults().length === 0) return
              if (event.altKey || event.metaKey) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                props.onSearchMove(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                props.onSearchMove(-1)
                return
              }
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                props.onSearchSelectActive()
              }
            }}
          />
          <Show when={props.searchValue()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="relative z-20 shrink-0"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              aria-label={props.language.t("common.clearSearch")}
              onClick={() => {
                props.onSearchClose()
                props.onSearchFocus()
              }}
            />
          </Show>
        </label>
      </div>
    </div>
  )
}

function HomeSessionSearchResultRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    selected: boolean
  },
) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)
  const showProjectName = () => props.showProjectName() && props.record.projectName
  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      role="option"
      aria-selected={props.selected}
      class={`
        flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 pl-[18px] pr-6 text-left
        transition-[background-color] duration-[120ms] ease-in-out
        hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      classList={{
        "bg-v2-overlay-simple-overlay-hover": props.selected,
        group: !!showProjectName(),
      }}
      onMouseEnter={() => props.onSearchHighlight(props.record)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onSearchSelect(props.record, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onSearchSelect(props.record, { background: true })
      }}
    >
      <HomeSessionLeadingController
        server={props.server}
        isOpenTab={props.isOpenTab}
        record={props.record}
        revealProjectOnHover={!!showProjectName()}
      />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} search />
        <Show when={showProjectName()}>
          <HomeSessionProjectName name={props.record.projectName} search />
        </Show>
      </div>
    </button>
  )
}

function HomeSessionGroupHeader(props: {
  title: string
  count?: number
  titleOpacity: number
  onSetRef: (element: HTMLDivElement) => void
  elevated?: boolean
}) {
  return (
    <div
      ref={props.onSetRef}
      class={`
        pointer-events-none sticky top-[84px] flex h-7 min-w-0 items-center justify-between
        bg-v2-background-bg-base pl-3 pr-1 lg:top-[108px]
      `}
      classList={{ "home-session-group-header z-[5]": !!props.elevated, "z-10": !props.elevated }}
    >
      <div class="flex items-center gap-2" style={{ opacity: props.titleOpacity }}>
        <span class={HOME_SECTION_LABEL}>{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-0.2 text-[10px] font-mono text-v2-text-text-muted">
            {props.count}
          </span>
        </Show>
      </div>
    </div>
  )
}

function HomeSessionCard(props: HomeSessionsViewProps & { record: HomeSessionRecord }) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)
  const showProjectName = () => props.showProjectName() && props.record.projectName
  const relativeTime = createMemo(() => {
    const ts = props.record.session.time.updated ?? props.record.session.time.created
    return getRelativeTime(new Date(ts).toISOString(), props.language.t)
  })
  const summary = () => props.record.session.summary
  const modelName = () => props.record.session.model?.id

  return (
    <HomeSessionLeadingController
      server={props.server}
      isOpenTab={props.isOpenTab}
      record={props.record}
      revealProjectOnHover={false}
      render={(state) => (
        <div
          data-component="home-session-card"
          class={`
            group/session relative flex flex-col justify-between rounded-[10px] border border-v2-border-border-muted
            bg-v2-background-bg-base p-3.5 text-left transition-[background-color,border-color,box-shadow,transform]
            duration-150 ease-out hover:border-v2-border-border-base hover:bg-v2-background-bg-layer-01/40 hover:shadow-[var(--v2-elevation-raised)]
          `}
          classList={{
            "ring-1 ring-v2-icon-icon-accent/40": state.loading(),
          }}
        >
          <button
            type="button"
            data-component="home-session-row"
            class="flex flex-1 flex-col text-left focus-visible:outline-none"
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault()
            }}
            onClick={(event) => props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })}
            onAuxClick={(event) => {
              if (!isBackgroundOpen(event)) return
              event.preventDefault()
              props.onOpenSession(props.record.session, { background: true })
            }}
          >
            <div class="flex items-center justify-between gap-2 pb-2">
              <div class="flex min-w-0 items-center gap-2">
                <HomeSessionLeading
                  record={props.record}
                  revealProjectOnHover={false}
                  open={state.open()}
                  unread={state.unread()}
                  loading={state.loading()}
                />
                <Show when={showProjectName()}>
                  <span class="truncate text-[11px] font-medium text-v2-text-text-muted">
                    {props.record.projectName}
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <Show when={state.loading()}>
                  <span class="inline-flex items-center gap-1 rounded bg-v2-icon-icon-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-v2-icon-icon-accent animate-pulse">
                    <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" />
                    {props.language.t("batuta.panel.status.busy")}
                  </span>
                </Show>
                <span class="text-[11px] text-v2-text-text-faint">{relativeTime()}</span>
              </div>
            </div>

            <h3
              class="line-clamp-2 min-w-0 text-[13px] font-[530] leading-snug tracking-[-0.04px] text-v2-text-text-base group-hover/session:text-v2-text-text-primary"
              title={title()}
            >
              {title()}
            </h3>

            <div class="mt-3 flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-v2-text-text-muted">
              <Show when={summary() && ((summary()?.files ?? 0) > 0 || (summary()?.additions ?? 0) > 0 || (summary()?.deletions ?? 0) > 0)}>
                <div class="flex items-center gap-1 font-mono text-[10px]">
                  <Show when={(summary()?.files ?? 0) > 0}>
                    <span class="rounded bg-v2-background-bg-layer-02 px-1 text-v2-text-text-muted">
                      {summary()!.files} {props.language.t("session.files.all")}
                    </span>
                  </Show>
                  <Show when={(summary()?.additions ?? 0) > 0}>
                    <span class="text-text-diff-add-base">+{summary()!.additions}</span>
                  </Show>
                  <Show when={(summary()?.deletions ?? 0) > 0}>
                    <span class="text-text-diff-delete-base">-{summary()!.deletions}</span>
                  </Show>
                </div>
              </Show>
              <Show when={modelName()}>
                <span class="max-w-[120px] truncate rounded bg-v2-background-bg-layer-02/60 px-1 text-[10px] text-v2-text-text-faint" title={modelName()}>
                  {modelName()?.split("/").pop()}
                </span>
              </Show>
            </div>
          </button>

          <Show when={SHOW_HOME_SESSION_ARCHIVE}>
            <div
              class={`
                hover-reveal absolute right-2 top-2 flex items-center
                group-hover/session:opacity-100 focus-within:opacity-100
              `}
            >
              <TooltipV2 class="flex shrink-0 items-center" placement="bottom" value={props.language.t("common.archive")}>
                <IconButtonV2
                  data-action="home-session-archive"
                  variant="ghost-muted"
                  size="normal"
                  icon={<IconV2 name="archive" size="small" />}
                  aria-label={props.language.t("common.archive")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void props.onArchiveSession(props.record.session)
                  }}
                />
              </TooltipV2>
            </div>
          </Show>
        </div>
      )}
    />
  )
}

function HomeSessionRow(props: HomeSessionsViewProps & { record: HomeSessionRecord }) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)
  const showProjectName = () => props.showProjectName() && props.record.projectName
  const relativeTime = createMemo(() => {
    const ts = props.record.session.time.updated ?? props.record.session.time.created
    return getRelativeTime(new Date(ts).toISOString(), props.language.t)
  })

  return (
    <div
      class={`
        group/session relative flex h-11 min-w-0 items-center rounded-[8px] border border-transparent
        transition-[background-color,border-color] duration-120 ease-in-out hover:border-v2-border-border-muted hover:bg-v2-overlay-simple-overlay-hover
      `}
      classList={{ group: !!showProjectName() }}
    >
      <button
        type="button"
        data-component="home-session-row"
        class={`
          flex h-11 min-w-0 w-full flex-1 shrink-0 cursor-default items-center gap-3 rounded-[8px] border-0
          bg-transparent py-2.5 pl-3 pr-12 text-left text-v2-text-text-muted [font-weight:530]
          focus-visible:outline-none
        `}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault()
        }}
        onClick={(event) => props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })}
        onAuxClick={(event) => {
          if (!isBackgroundOpen(event)) return
          event.preventDefault()
          props.onOpenSession(props.record.session, { background: true })
        }}
      >
        <HomeSessionLeadingController
          server={props.server}
          isOpenTab={props.isOpenTab}
          record={props.record}
          revealProjectOnHover={!!showProjectName()}
        />
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} />
          <Show when={showProjectName()}>
            <HomeSessionProjectName name={props.record.projectName} />
          </Show>
        </div>
        <span class="shrink-0 text-[11px] text-v2-text-text-faint">{relativeTime()}</span>
      </button>
      <Show when={SHOW_HOME_SESSION_ARCHIVE}>
        <div
          class={`
            hover-reveal absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1
            group-hover/session:opacity-100 focus-within:opacity-100
          `}
        >
          <TooltipV2 class="flex shrink-0 items-center" placement="bottom" value={props.language.t("common.archive")}>
            <IconButtonV2
              data-action="home-session-archive"
              variant="ghost-muted"
              size="normal"
              icon={<IconV2 name="archive" size="small" />}
              aria-label={props.language.t("common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void props.onArchiveSession(props.record.session)
              }}
            />
          </TooltipV2>
        </div>
      </Show>
    </div>
  )
}

function HomeSessionTitle(props: { title: string; showProjectName: boolean; search?: boolean }) {
  return (
    <span
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530]"
      classList={{
        "text-[13px] leading-4 tracking-[-0.04px]": !!props.search,
        "max-w-[min(70%,480px)] flex-[0_1_auto]": props.showProjectName,
        "flex-[1_1_auto]": !props.showProjectName,
      }}
    >
      {props.title}
    </span>
  )
}

function HomeSessionProjectName(props: { name: string; search?: boolean }) {
  return (
    <span
      class="min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]"
      classList={{ "text-[13px] leading-4 tracking-[-0.04px]": !!props.search }}
    >
      {props.name}
    </span>
  )
}

function HomeSessionsEmpty(props: { onNewSession?: () => void; language: ReturnType<typeof useLanguage> }) {
  return (
    <div class="flex min-h-full flex-col items-center gap-4 px-6 pt-[52px] text-center">
      <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 text-v2-icon-icon-muted">
        <Icon name="comment" class="size-4" />
      </div>
      <div
        class={`
          shrink-0 text-[13px] leading-[13px] tracking-[-0.04px]
          text-v2-text-text-base [font-weight:530]
        `}
      >
        {props.language.t("home.sessions.empty")}
      </div>
      <p
        class={`
          mb-1 text-center text-[13px] leading-5 tracking-[-0.04px]
          text-v2-text-text-muted [font-weight:440]
        `}
      >
        {props.language.t("home.sessions.empty.description")}
      </p>
      <Show when={props.onNewSession}>
        {(onNewSession) => (
          <ButtonV2 data-action="home-new-session" variant="neutral" size="normal" icon="edit" onClick={onNewSession()}>
            {props.language.t("command.session.new")}
          </ButtonV2>
        )}
      </Show>
    </div>
  )
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}
