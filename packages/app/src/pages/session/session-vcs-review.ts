import { createMemo } from "solid-js"
import { createQuery, skipToken, type QueryClient } from "@tanstack/solid-query"
import { debounce } from "@solid-primitives/scheduled"
import type { UserMessage, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { diffs as list } from "@/utils/diffs"
import { reviewDiffDirectory, reviewDiffNeedsLoad, reviewRootDirectory } from "@/pages/session/v2/review-diff-kinds"
import type { useSDK } from "@/context/sdk"
import type { useServerSDK } from "@/context/server-sdk"
import type { useSync } from "@/context/sync"

export type ChangeMode = "git" | "branch" | "turn"
export type VcsMode = "git" | "branch"

/**
 * Owns "what changed" for the review panel: the VCS diff query (git
 * working tree / branch comparison), the per-turn diff summary fallback,
 * and the derived availability/loading flags the review UI reads. Also
 * listens for filesystem-watcher events to refresh the VCS query, since
 * that's purely a trigger for re-fetching this same data.
 */
export function createVcsReview(deps: {
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  serverSDK: ReturnType<typeof useServerSDK>
  queryClient: QueryClient
  isDesktop: () => boolean
  desktopFileTreeOpen: () => boolean
  desktopReviewOpen: () => boolean
  newSessionDesign: () => boolean
  activeTab: () => string
  activeFileTab: () => string | undefined
  mobileTab: () => "session" | "changes"
  reviewMode: () => ChangeMode
  reviewFile: () => string | undefined
  lastUserMessage: () => UserMessage | undefined
}) {
  const {
    sync,
    sdk,
    serverSDK,
    queryClient,
    isDesktop,
    desktopFileTreeOpen,
    desktopReviewOpen,
    newSessionDesign,
    activeTab,
    activeFileTab,
    mobileTab,
    reviewMode,
    reviewFile,
    lastUserMessage,
  } = deps

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => {
    const project = sync().project
    return !!project && project.vcs !== "git"
  })
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const result: ChangeMode[] = []
    const project = sync().project
    const vcs = sync().data.vcs
    if (project?.vcs === "git") result.push("git")
    if (project?.vcs === "git" && vcs?.branch && vcs?.default_branch && vcs.branch !== vcs.default_branch) {
      result.push("branch")
    }
    result.push("turn")
    return result
  })
  const mobileChanges = createMemo(() => !isDesktop() && mobileTab() === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() ||
        (desktopReviewOpen() && (activeTab() === "review" || (newSessionDesign() && !!activeFileTab())))
      : mobileTab() === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    const mode = reviewMode()
    if (mode === "git" || mode === "branch") return mode
  })
  const vcsKey = createMemo(
    () =>
      ["session-vcs", sdk().directory, sync().data.vcs?.branch ?? "", sync().data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync().project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      queryFn: mode
        ? () =>
            sdk()
              .api.vcs.diff({ location: { directory: sdk().directory }, mode: mode === "git" ? "working" : mode })
              .then((result) => result.data)
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = debounce(() => void queryClient.invalidateQueries({ queryKey: vcsKey() }), 100)
  const reviewDiffs = () => {
    if (reviewMode() === "git" || reviewMode() === "branch")
      // avoids suspense
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const activeReviewFile = () => {
    const diffs = reviewDiffs()
    const selected = reviewFile()
    if (selected && diffs.some((diff) => diff.file === selected)) return selected
    return diffs[0]?.file
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (reviewMode() === "git" || reviewMode() === "branch") return !vcsQuery.isPending
    return true
  }
  const loadReviewDiff = async (file: string, version?: number): Promise<VcsFileDiff | undefined> => {
    const mode = vcsMode()
    if (!mode) return
    const root = reviewRootDirectory(sync().project?.worktree ?? sdk().directory)
    const directory = reviewDiffDirectory(root, file)
    const source = reviewDiffs().find((diff) => diff.file === file)
    const valid = (diff: VcsFileDiff | undefined) => {
      if (!diff || !source) return
      if (diff.additions !== source.additions || diff.deletions !== source.deletions) return
      if (reviewDiffNeedsLoad(diff)) return
      return diff
    }
    const request = (scope: string, context?: number) =>
      queryClient
        .fetchQuery({
          queryKey: [serverSDK().scope, ...vcsKey(), mode, "directory", scope, context, version] as const,
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () =>
            sdk()
              .api.vcs.diff({
                location: { directory: scope },
                mode: mode === "git" ? "working" : mode,
                context,
              })
              .then((result) => result.data),
        })
        .then((diffs) => diffs.find((diff) => diff.file === file))

    if (directory !== root) {
      try {
        const scoped = valid(await request(directory))
        if (scoped) return scoped
      } catch (error) {
        console.debug("[session-review] failed to load scoped vcs diff", { mode, file, directory, error })
      }
    }
    try {
      const bounded = valid(await request(root, 3))
      if (bounded) return bounded
    } catch (error) {
      console.debug("[session-review] failed to load bounded vcs diff", { mode, file, root, error })
    }
  }

  const stopVcs = sdk().event.listen((evt) => {
    const details = evt.details as { type: string; properties?: unknown }
    if (details.type !== "file.watcher.updated" && details.type !== "filesystem.changed") return
    const props =
      typeof details.properties === "object" && details.properties
        ? (details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })

  return {
    turnDiffs,
    nogit,
    changesOptions,
    mobileChanges,
    wantsReview,
    vcsMode,
    vcsKey,
    vcsQuery,
    refreshVcs,
    reviewDiffs,
    activeReviewFile,
    reviewCount,
    hasReview,
    reviewReady,
    loadReviewDiff,
    stopVcs,
  }
}
