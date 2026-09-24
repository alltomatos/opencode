import { createEffect, createMemo, createResource, createSignal, For, onCleanup, on, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { showToast } from "@/utils/toast"

type MemoryTab = "project" | "global"

type MemoryItem = {
  id: string
  timestamp?: string
  text: string
}

function parseMemoryContent(raw: string): MemoryItem[] {
  if (!raw || !raw.trim()) return []

  const regex = /^##\s+(\d{4}-\d{2}-\d{2}T[^\r\n]*)/gm
  const matches = [...raw.matchAll(regex)]

  if (matches.length === 0) {
    const parts = raw.split(/^##\s+/m).filter((p) => p.trim())
    return parts
      .map((part, idx) => {
        const firstNewline = part.indexOf("\n")
        if (firstNewline > -1) {
          const header = part.slice(0, firstNewline).trim()
          const body = part.slice(firstNewline + 1).trim()
          return {
            id: String(idx),
            timestamp: header,
            text: body || header,
          }
        }
        return { id: String(idx), text: part.trim() }
      })
      .reverse()
  }

  const items: MemoryItem[] = []
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i]
    const timestamp = currentMatch[1].trim()
    const startIndex = currentMatch.index! + currentMatch[0].length
    const endIndex = i + 1 < matches.length ? matches[i + 1].index! : raw.length
    const body = raw.slice(startIndex, endIndex).trim()
    if (body) {
      items.push({
        id: `${timestamp}-${i}`,
        timestamp,
        text: body,
      })
    }
  }

  return items.reverse()
}

function formatMemoryDate(ts?: string): string {
  if (!ts) return ""
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts

    const now = new Date()
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()

    const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    if (isToday) {
      return `Hoje às ${timeStr}`
    }

    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ts
  }
}

function formatInlineMarkdown(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-v2-text-text-base">$1</strong>')
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1.5 py-0.5 rounded-md bg-v2-background-bg-layer-02 font-mono text-[11px] text-v2-text-brand-primary border border-v2-border-border-base/50">$1</code>',
    )
}

function getSectionBadge(title: string) {
  const lower = title.toLowerCase()
  if (lower.includes("fato") || lower.includes("descoberta") || lower.includes("novo")) {
    return { icon: "sparkles", label: title, style: "text-blue-500 bg-blue-500/10 border-blue-500/20" }
  }
  if (lower.includes("decis") || lower.includes("convenç") || lower.includes("regra")) {
    return { icon: "check", label: title, style: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" }
  }
  if (lower.includes("pendên") || lower.includes("aberto") || lower.includes("próximo") || lower.includes("todo")) {
    return { icon: "checklist", label: title, style: "text-amber-500 bg-amber-500/10 border-amber-500/20" }
  }
  if (lower.includes("correç") || lower.includes("ajuste") || lower.includes("erro")) {
    return { icon: "warning", label: title, style: "text-orange-500 bg-orange-500/10 border-orange-500/20" }
  }
  if (lower.includes("context") || lower.includes("sessão") || lower.includes("método")) {
    return { icon: "code-lines", label: title, style: "text-purple-500 bg-purple-500/10 border-purple-500/20" }
  }
  return { icon: "bullet-list", label: title, style: "text-v2-text-text-muted bg-v2-background-bg-layer-02 border-v2-border-border-base" }
}

export function SessionMemoryTab() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const sync = useSync()
  const params = useParams()
  const { view } = useSessionLayout()

  const resolvedDirectory = createMemo(() => {
    if (params.dir) return decode64(params.dir) ?? undefined
    const session = sync().data.session.find((s) => s.id === params.id)
    if (session?.directory) return session.directory
    try {
      return sdk().directory || undefined
    } catch {
      return undefined
    }
  })

  const hasProject = () => Boolean(resolvedDirectory())
  const [tab, setTab] = createSignal<MemoryTab>(hasProject() ? "project" : "global")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [newNote, setNewNote] = createSignal("")
  const [savingNote, setSavingNote] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [promotingId, setPromotingId] = createSignal<string | null>(null)
  const [backfilling, setBackfilling] = createSignal(false)
  const [copiedId, setCopiedId] = createSignal<string | null>(null)

  const [projectContent, { refetch: refetchProject }] = createResource(
    () => resolvedDirectory(),
    async (dir) => {
      if (!dir) return ""
      try {
        const res = await serverSDK().client.memory.getProjectEntries({ directory: dir })
        return res.data?.content ?? ""
      } catch {
        return ""
      }
    },
  )

  const [globalContent, { refetch: refetchGlobal }] = createResource(async () => {
    try {
      const res = await serverSDK().client.memory.getGlobalEntries()
      return res.data?.content ?? ""
    } catch {
      return ""
    }
  })

  const refresh = () => {
    void refetchProject()
    void refetchGlobal()
  }

  const projectItems = createMemo(() => parseMemoryContent(projectContent() ?? ""))
  const globalItems = createMemo(() => parseMemoryContent(globalContent() ?? ""))

  const filteredItems = createMemo(() => {
    const query = searchQuery().trim().toLowerCase()
    const items = tab() === "project" ? projectItems() : globalItems()
    if (!query) return items
    return items.filter(
      (item) => item.text.toLowerCase().includes(query) || (item.timestamp && item.timestamp.toLowerCase().includes(query)),
    )
  })

  const handleCopy = (item: MemoryItem) => {
    navigator.clipboard
      .writeText(item.text)
      .then(() => {
        setCopiedId(item.id)
        setTimeout(() => setCopiedId(null), 2000)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("dialog.memory.copy.success"),
        })
      })
      .catch(() => undefined)
  }

  const handleAddNote = async () => {
    const note = newNote().trim()
    const dir = resolvedDirectory()
    if (!note || savingNote()) return
    setSavingNote(true)
    try {
      const isGlobal = tab() === "global" || !dir
      await serverSDK().client.memory.addEntry({
        body_directory: isGlobal ? undefined : dir,
        note,
        global: isGlobal,
      })
      setNewNote("")
      refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.memory.toast.saved"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setSavingNote(false)
    }
  }

  const handlePromote = async (item: MemoryItem) => {
    if (promotingId()) return
    setPromotingId(item.id)
    try {
      await serverSDK().client.memory.promote({ summary: item.text })
      refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.memory.promote.success"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setPromotingId(null)
    }
  }

  const handleForgetProject = async () => {
    const dir = resolvedDirectory()
    if (!dir || deleting()) return
    if (!confirm(language.t("dialog.memory.forgetProject.confirm"))) return
    setDeleting(true)
    try {
      await serverSDK().client.memory.forgetProject({ directory: dir })
      refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.memory.forgetProject.success"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setDeleting(false)
    }
  }

  const handleBackfill = async () => {
    if (backfilling()) return
    setBackfilling(true)
    try {
      const isProject = tab() === "project" && resolvedDirectory()
      const res = await serverSDK().client.memory.backfill({
        body_directory: isProject ? resolvedDirectory() : undefined,
      })
      refresh()
      const data = res.data
      if (data) {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("dialog.memory.backfill.success", {
            count: data.summarizedSessions,
            total: data.totalSessions,
          }),
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setBackfilling(false)
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return
    const s = view().scroll("memory")
    if (!s) return
    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const next = pending
      pending = undefined
      if (!next) return
      view().setScroll("memory", next)
    })
  }

  createEffect(
    on(
      () => filteredItems().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base">
      {/* Header Controls: Subtabs + Search + Backfill Action */}
      <div class="px-5 py-3 flex flex-wrap items-center justify-between gap-2.5 bg-v2-background-bg-layer-01 border-b border-v2-border-border-base/60 shrink-0">
        <Show when={hasProject()}>
          <div class="inline-flex rounded-lg bg-v2-background-bg-base p-0.5 text-[12px] border border-v2-border-border-base gap-0.5 shadow-xs">
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md px-3 py-1 transition-all"
              classList={{
                "bg-v2-surface-brand-primary text-white font-medium shadow-xs": tab() === "project",
                "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02":
                  tab() !== "project",
              }}
              onClick={() => {
                setTab("project")
                setSearchQuery("")
              }}
            >
              <Icon name="folder" size="small" />
              <span>{language.t("dialog.memory.tab.project")}</span>
              <span
                class="ml-0.5 rounded-full px-1.5 py-0.2 text-[10px]"
                classList={{
                  "bg-white/20 text-white": tab() === "project",
                  "bg-v2-background-bg-layer-02 text-v2-text-text-muted": tab() !== "project",
                }}
              >
                {projectItems().length}
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md px-3 py-1 transition-all"
              classList={{
                "bg-v2-surface-brand-primary text-white font-medium shadow-xs": tab() === "global",
                "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02":
                  tab() !== "global",
              }}
              onClick={() => {
                setTab("global")
                setSearchQuery("")
              }}
            >
              <Icon name="providers" size="small" />
              <span>{language.t("dialog.memory.tab.global")}</span>
              <span
                class="ml-0.5 rounded-full px-1.5 py-0.2 text-[10px]"
                classList={{
                  "bg-white/20 text-white": tab() === "global",
                  "bg-v2-background-bg-layer-02 text-v2-text-text-muted": tab() !== "global",
                }}
              >
                {globalItems().length}
              </span>
            </button>
          </div>
        </Show>

        <div class="flex items-center gap-2 flex-1 justify-end min-w-[220px]">
          <div class="relative flex-1 max-w-[240px]">
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-v2-text-text-faint pointer-events-none">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              type="text"
              placeholder={language.t("dialog.memory.search.placeholder")}
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full h-7.5 pl-8 pr-7 text-[12px] rounded-lg border border-v2-border-border-base bg-v2-background-bg-base placeholder:text-v2-text-text-faint text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus transition-colors"
            />
            <Show when={searchQuery().trim().length > 0}>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                class="absolute right-2 top-1/2 -translate-y-1/2 text-v2-text-text-faint hover:text-v2-text-text-base"
              >
                <Icon name="circle-x" size="small" />
              </button>
            </Show>
          </div>

          <ButtonV2
            variant="outline"
            size="small"
            disabled={backfilling()}
            onClick={handleBackfill}
            class="text-[11.5px] h-7.5 px-2.5 gap-1 rounded-lg hover:border-v2-border-border-strong transition-colors shrink-0"
            title={language.t("dialog.memory.backfill.button")}
          >
            <Icon name="brain" size="small" />
            <span>
              {backfilling()
                ? language.t("dialog.memory.backfill.running")
                : language.t("dialog.memory.backfill.button")}
            </span>
          </ButtonV2>
        </div>
      </div>

      {/* Main Scrollable Memory List */}
      <ScrollView
        class="@container flex-1 min-h-0"
        viewportRef={(el) => {
          scroll = el
          restoreScroll()
        }}
        onScroll={handleScroll}
      >
        <div class="px-5 py-4 flex flex-col gap-3.5">
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 text-center text-v2-text-text-faint">
                <div class="size-12 rounded-2xl bg-v2-background-bg-layer-02 border border-v2-border-border-base/50 flex items-center justify-center mb-3 text-v2-text-text-muted">
                  <Icon name="brain" size="large" />
                </div>
                <p class="text-[14px] font-medium text-v2-text-text-base mb-1">
                  {searchQuery().trim().length > 0
                    ? language.t("dialog.memory.empty.search.title")
                    : tab() === "project"
                      ? language.t("dialog.memory.empty.project.title")
                      : language.t("dialog.memory.empty.global.title")}
                </p>
                <p class="text-[12px] font-normal max-w-sm leading-relaxed text-v2-text-text-muted">
                  {searchQuery().trim().length > 0
                    ? language.t("dialog.memory.empty.search.description")
                    : tab() === "project"
                      ? language.t("dialog.memory.empty.project.description")
                      : language.t("dialog.memory.empty.global.description")}
                </p>
              </div>
            }
          >
            <For each={filteredItems()}>
              {(item) => (
                <div class="flex flex-col rounded-xl border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4 transition-all hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-01/90 shadow-xs">
                  {/* Card Top Metadata */}
                  <div class="flex items-center justify-between pb-2 mb-2 border-b border-v2-border-border-base/40">
                    <span class="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-v2-text-text-faint">
                      <Icon name={tab() === "project" ? "folder" : "providers"} size="small" />
                      <span>{formatMemoryDate(item.timestamp) || language.t("settings.memory.title")}</span>
                    </span>

                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopy(item)}
                        class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02 transition-colors"
                        title={language.t("dialog.memory.copy.button")}
                      >
                        <Icon name={copiedId() === item.id ? "circle-check" : "copy"} size="small" />
                        <span>{copiedId() === item.id ? "Copiado" : language.t("dialog.memory.copy.button")}</span>
                      </button>

                      <Show when={tab() === "project"}>
                        <ButtonV2
                          variant="ghost"
                          size="small"
                          disabled={promotingId() === item.id}
                          onClick={() => handlePromote(item)}
                          class="text-[11.5px] font-medium text-v2-text-brand-primary hover:bg-v2-surface-brand-primary/10 gap-1 px-2.5 py-0.5 h-6"
                        >
                          <Icon name="arrow-right" size="small" />
                          <span>{language.t("dialog.memory.promote.button")}</span>
                        </ButtonV2>
                      </Show>
                    </div>
                  </div>

                  {/* Card Content with structured badges */}
                  <div class="flex flex-col gap-1.5 text-[13px] text-v2-text-text-muted leading-relaxed">
                    <For each={item.text.split("\n")}>
                      {(line) => {
                        const trimmed = line.trim()
                        if (!trimmed) return null
                        if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
                          const heading = trimmed.replace(/^#+\s*/, "")
                          const badge = getSectionBadge(heading)
                          return (
                            <div class="pt-1.5 pb-0.5">
                              <span
                                class={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${badge.style}`}
                              >
                                <span>{badge.label}</span>
                              </span>
                            </div>
                          )
                        }
                        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                          const content = trimmed.replace(/^[-*]\s+/, "")
                          return (
                            <div class="flex items-start gap-2 pl-1">
                              <span class="text-v2-text-text-faint mt-1.5 text-[8px] leading-none select-none">•</span>
                              <span class="flex-1 text-v2-text-text-base" innerHTML={formatInlineMarkdown(content)} />
                            </div>
                          )
                        }
                        return (
                          <div class="text-v2-text-text-base pl-0.5" innerHTML={formatInlineMarkdown(trimmed)} />
                        )
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </ScrollView>

      {/* Footer Controls: Add Quick Note + Forget */}
      <div class="px-5 py-3 border-t border-v2-border-border-base bg-v2-background-bg-layer-01 flex flex-col gap-2 shrink-0">
        <div class="flex items-center gap-2">
          <textarea
            class="flex-1 min-h-[36px] max-h-[90px] resize-none rounded-lg border border-v2-border-border-base bg-v2-background-bg-base px-3 py-1.5 text-[12.5px] text-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus-visible:border-v2-border-border-focus transition-colors"
            placeholder={language.t("dialog.memory.addNote.placeholder")}
            value={newNote()}
            onInput={(e) => setNewNote(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleAddNote()
              }
            }}
          />
          <ButtonV2
            variant="contrast"
            size="normal"
            disabled={!newNote().trim() || savingNote()}
            onClick={handleAddNote}
            class="h-9 px-3.5 rounded-lg text-[12.5px]"
          >
            <Icon name="plus" size="small" />
            <span>{language.t("dialog.memory.addNote.button")}</span>
          </ButtonV2>
        </div>

        <Show when={tab() === "project" && projectItems().length > 0}>
          <div class="flex items-center justify-between pt-0.5">
            <span class="text-[11px] text-v2-text-text-faint">
              {projectItems().length} {projectItems().length === 1 ? "sessão registrada" : "sessões registradas"}
            </span>
            <ButtonV2
              variant="danger"
              size="small"
              disabled={deleting()}
              onClick={handleForgetProject}
              class="text-[11px] h-5.5 px-2"
            >
              <Icon name="trash" size="small" />
              <span>{language.t("dialog.memory.forgetProject.button")}</span>
            </ButtonV2>
          </div>
        </Show>
      </div>
    </div>
  )
}
