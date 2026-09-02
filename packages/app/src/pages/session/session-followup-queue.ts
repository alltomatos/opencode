import { createMemo } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { Identifier } from "@/utils/id"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import type { useServerSync } from "@/context/server-sync"
import type { useLanguage } from "@/context/language"
import type { createSessionOwnership } from "./session-ownership"

export type FollowupItem = FollowupDraft & { id: string }
export type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">

const emptyFollowups: FollowupItem[] = []

/**
 * Owns the "queue a followup while the session is busy" flow: the queued
 * items, the mutation that sends one (with optimistic paused/failed state),
 * and the label text shown in the dock. Extracted because it's a
 * self-contained request/queue concern independent of layout, review, or
 * scroll state — the persisted `followup` store itself stays owned by
 * session.tsx since other code paths (session-switch cleanup) touch it too.
 */
export function createFollowupQueue(deps: {
  sessionID: () => string | undefined
  followup: {
    items: Record<string, FollowupItem[] | undefined>
    failed: Record<string, string | undefined>
    paused: Record<string, boolean | undefined>
    edit: Record<string, FollowupEdit | undefined>
  }
  setFollowup: (...args: any[]) => void
  sessionOwnership: ReturnType<typeof createSessionOwnership>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  serverSync: ReturnType<typeof useServerSync>
  language: ReturnType<typeof useLanguage>
  fail: (err: unknown) => void
  resumeScroll: () => void
  followupQueueEnabled: () => boolean
  busy: (sessionID: string) => boolean
  composerBlocked: () => boolean
  isChildSession: () => boolean
}) {
  const {
    sessionID,
    followup,
    setFollowup,
    sessionOwnership,
    sdk,
    sync,
    serverSync,
    language,
    fail,
    resumeScroll,
    followupQueueEnabled,
    busy,
    composerBlocked,
    isChildSession,
  } = deps

  const queuedFollowups = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return followup.edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; id: string; manual?: boolean }) => {
      const owner = sessionOwnership.capture()
      const item = (followup.items[input.sessionID] ?? []).find((entry) => entry.id === input.id)
      if (!item) return

      if (input.manual) setFollowup("paused", input.sessionID, undefined)
      setFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        api: sdk().api.session,
        sync: sync(),
        serverSync: serverSync(),
        draft: item,
        optimisticBusy: item.sessionDirectory === sdk().directory,
      }).catch((err) => {
        setFollowup("failed", input.sessionID, input.id)
        fail(err)
        return false
      })
      if (!ok) return

      setFollowup("items", input.sessionID, (items: FollowupItem[] | undefined) =>
        (items ?? []).filter((entry) => entry.id !== input.id),
      )
      if (input.manual) owner.run(resumeScroll)
    },
  }))

  const followupBusy = (id: string) => followupMutation.isPending && followupMutation.variables?.sessionID === id

  const sendingFollowup = createMemo(() => {
    const id = sessionID()
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.id
  })

  const queueEnabled = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    return followupQueueEnabled() && busy(id) && !composerBlocked() && !isChildSession()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items: FollowupItem[] | undefined) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    if (sync().session.get(sessionID)?.parentID) return Promise.resolve()
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followupBusy(sessionID)) return Promise.resolve()

    return followupMutation.mutateAsync({ sessionID, id, manual: opts?.manual })
  }

  const editFollowup = (id: string) => {
    const id_ = sessionID()
    if (!id_) return
    if (followupBusy(id_)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", id_, (items: FollowupItem[] | undefined) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", id_, (value: string | undefined) => (value === id ? undefined : value))
    setFollowup("edit", id_, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = sessionID()
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  return {
    queuedFollowups,
    editingFollowup,
    followupMutation,
    followupBusy,
    sendingFollowup,
    queueEnabled,
    followupText,
    queueFollowup,
    followupDock,
    sendFollowup,
    editFollowup,
    clearFollowupEdit,
  }
}
