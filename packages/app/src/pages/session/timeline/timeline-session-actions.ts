import { produce } from "solid-js/store"
import { createStore } from "solid-js/store"
import { createEffect, on, type JSX } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import type { useLanguage } from "@/context/language"
import type { useSync } from "@/context/sync"
import type { useSDK } from "@/context/sdk"
import type { useServerSDK } from "@/context/server-sdk"
import type { usePlatform } from "@/context/platform"
import type { useSessionArchive } from "@/pages/session/session-archive"
import type { useNavigate, useParams } from "@solidjs/router"

/**
 * Owns the session header's user-triggered actions: share/unshare, inline
 * title rename, export, delete, and "go to parent session". Extracted from
 * MessageTimeline because these are independent, click-driven flows with no
 * dependency on the virtualizer/scroll machinery — the header JSX still
 * lives in MessageTimeline and just wires buttons to what this returns.
 */
export function createSessionHeaderActions(deps: {
  sessionID: () => string | undefined
  sessionKey: () => string
  parentID: () => string | undefined
  titleLabel: () => string | undefined
  shareUrl: () => string | undefined
  shareEnabled: () => boolean
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  serverSDK: ReturnType<typeof useServerSDK>
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  sessionArchive: ReturnType<typeof useSessionArchive>
  navigate: ReturnType<typeof useNavigate>
  params: ReturnType<typeof useParams>
}) {
  const {
    sessionID,
    sessionKey,
    parentID,
    titleLabel,
    shareUrl,
    shareEnabled,
    sync,
    sdk,
    serverSDK,
    platform,
    language,
    sessionArchive,
    navigate,
    params,
  } = deps

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined
  const bindTitleRef = (el: HTMLInputElement) => {
    titleRef = el
  }

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openExternal(url)
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => serverSDK().client.session.share({ sessionID: id }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => serverSDK().client.session.unshare({ sessionID: id }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk().api.session.rename({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync().set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  const shareSession = () => {
    const id = sessionID()
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  const copyShareUrl = () => {
    const url = shareUrl()
    if (!url) return
    void navigator.clipboard
      .writeText(url)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: url,
        }),
      )
      .catch((err: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        }),
      )
  }

  const selectShareUrlText: JSX.EventHandler<HTMLDivElement, MouseEvent> = (event) => {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(event.currentTarget)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      if (!titleRef) return
      titleRef.focus()
      titleRef.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const exportSession = async (sessionID: string) => {
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync().session.get(sessionID)
    if (!session) return false

    const sessions = (sync().data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk()
      .api.session.remove({ sessionID })
      .then(() => true)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    const removed = new Set<string>([sessionID])
    const byParent = new Map<string, string[]>()
    for (const item of sync().data.session) {
      const itemParentID = item.parentID
      if (!itemParentID) continue
      const existing = byParent.get(itemParentID)
      if (existing) {
        existing.push(item.id)
        continue
      }
      byParent.set(itemParentID, [item.id])
    }

    const stack = [sessionID]
    while (stack.length) {
      const currentParentID = stack.pop()
      if (!currentParentID) continue

      const children = byParent.get(currentParentID)
      if (!children) continue

      for (const child of children) {
        if (removed.has(child)) continue
        removed.add(child)
        stack.push(child)
      }
    }

    sessionArchive.navigateAfterRemoval(sessionID, session.parentID, nextSession?.id)

    sync().set(
      produce((draft) => {
        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    for (const id of removed) {
      sync().session.evict(id)
    }
    notifySessionTabsRemoved({ directory: sdk().directory, sessionIDs: [...removed] })
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(
      params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : legacySessionHref(sdk().directory, id),
    )
  }

  return {
    title,
    setTitle,
    bindTitleRef,
    share,
    setShare,
    shareMutation,
    unshareMutation,
    titleMutation,
    viewShare,
    shareSession,
    unshareSession,
    copyShareUrl,
    selectShareUrlText,
    openTitleEditor,
    closeTitleEditor,
    saveTitleEditor,
    exportSession,
    deleteSession,
    navigateParent,
    errorMessage,
  }
}
