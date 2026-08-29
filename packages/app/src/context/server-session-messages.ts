import { retry } from "@opencode-ai/core/util/retry"
import type { SessionApi, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/v2/client"
import { batch } from "solid-js"
import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { message as cleanMessage } from "@/utils/diffs"
import { compareMessages, normalizeSessionMessages } from "@/utils/session-message"
import {
  cmp,
  legacyMessageSource,
  merge,
  mergeOptimisticPage,
  needsOlderTurnRoot,
  reconcileFetched,
  SKIP_PARTS,
  type MessageLoadBaseline,
  type MessageLoadState,
  type MessagePage,
  type OptimisticItem,
} from "@/context/server-session-helpers"
import type { ServerApi } from "@/utils/server"

type MessageApi = ServerApi["message"]

type ServerSessionOptions = { retry?: typeof retry; protocol?: Promise<"v1" | "v2"> }

type StoreData = {
  info: Record<string, unknown>
  message: Record<string, Message[] | undefined>
  session_message: Record<string, SessionMessageInfo[] | undefined>
  part: Record<string, Part[] | undefined>
  part_text_accum_delta: Record<string, string | undefined>
}

export function createMessageLoader(input: {
  client: OpencodeClient
  sessionApi?: SessionApi
  messageApi?: MessageApi
  options?: ServerSessionOptions
  data: StoreData
  setData: SetStoreFunction<StoreData>
  meta: { limit: Record<string, number | undefined>; loading: Record<string, boolean | undefined> }
  setMeta: SetStoreFunction<{
    limit: Record<string, number | undefined>
    cursor: Record<string, string | undefined>
    complete: Record<string, boolean | undefined>
    loading: Record<string, boolean | undefined>
    at: Record<string, number | undefined>
  }>
  messageLoads: Map<string, MessageLoadState>
  pendingParts: Map<string, Map<string, Set<string>>>
  orphanParts: Map<string, Set<string>>
  deltaBases: Map<string, { base: string; sessionID: string }>
  optimistic: Map<string, Map<string, OptimisticItem>>
  removedMessages: Map<string, Set<string>>
  generations: Map<string, object>
  generation: (sessionID: string) => object
  deleteMessageParts: (
    cache: { part: Record<string, Part[] | undefined>; part_text_accum_delta: Record<string, string | undefined> },
    messageID: string,
  ) => void
  confirmOptimistic: (sessionID: string, messageID: string, confirmedParts: Part[]) => void
}) {
  const { client, sessionApi, messageApi, options, data, setData, meta, setMeta } = input
  const { messageLoads, pendingParts, orphanParts, deltaBases, optimistic, removedMessages } = input
  const { generations, generation, deleteMessageParts, confirmOptimistic } = input

  const resetMessageLoad = (sessionID: string, load: MessageLoadState, baseline?: MessageLoadBaseline) => {
    load.touchedMessages.clear()
    load.retainedMessages.clear()
    load.touchedParts.clear()
    load.carriedDeltaParts.clear()
    load.clearedMessageParts.clear()
    for (const messageID of load.removedMessages) {
      load.touchedMessages.add(messageID)
      load.clearedMessageParts.add(messageID)
    }
    for (const [messageID, parts] of load.deltaParts) {
      load.touchedParts.set(messageID, new Set(parts))
      load.carriedDeltaParts.set(messageID, new Set(parts))
      const messages = data.message[sessionID]
      if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.removedParts) {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
      const messages = data.message[sessionID]
      if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.optimisticParts) {
      load.removedMessages.delete(messageID)
      load.clearedMessageParts.add(messageID)
      load.touchedMessages.add(messageID)
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
    }
    baseline?.touchedMessages.forEach((messageID) => load.touchedMessages.add(messageID))
    baseline?.retainedMessages.forEach((messageID) => load.retainedMessages.add(messageID))
    baseline?.clearedMessageParts.forEach((messageID) => load.clearedMessageParts.add(messageID))
    baseline?.touchedParts.forEach((parts, messageID) => {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
    })
  }

  const messageLoadBaseline = (load: MessageLoadState, exclude: string): MessageLoadBaseline => ({
    touchedMessages: new Set([...load.touchedMessages].filter((messageID) => messageID !== exclude)),
    retainedMessages: new Set([...load.retainedMessages].filter((messageID) => messageID !== exclude)),
    touchedParts: new Map(
      [...load.touchedParts]
        .filter(([messageID]) => messageID !== exclude)
        .map(([messageID, parts]) => [messageID, new Set(parts)]),
    ),
    clearedMessageParts: new Set([...load.clearedMessageParts].filter((messageID) => messageID !== exclude)),
  })

  const fetchMessages = async (sessionID: string, limit: number, before?: string, onAttempt?: () => void) => {
    if (messageApi && (await options?.protocol) !== "v1") {
      const request = (cursor?: string) =>
        (options?.retry ?? retry)(() => {
          onAttempt?.()
          return messageApi.list(cursor ? { sessionID, limit, cursor } : { sessionID, limit, order: "desc" })
        })
      const first = await request(before)
      const pages = [first]
      while (pages.at(-1)?.cursor.next && needsOlderTurnRoot(pages.flatMap((page) => page.data).toReversed())) {
        const response = await request(pages.at(-1)!.cursor.next ?? undefined)
        pages.push(response)
        if (!response.data.length) break
      }
      const response = pages.at(-1)!
      const source = pages.flatMap((page) => page.data).toReversed()
      const normalized = normalizeSessionMessages(sessionID, source)
      return {
        session: normalized.messages.sort(compareMessages),
        part: [...normalized.parts.entries()]
          .map(([id, part]) => ({ id, part: part.sort((a, b) => cmp(a.id, b.id)) }))
          .sort((a, b) => cmp(a.id, b.id)),
        source,
        sourceMode: before ? ("older" as const) : ("latest" as const),
        projectSource: true,
        cursor: response.cursor.next ?? undefined,
        complete: response.data.length === 0,
      }
    }
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.messages({ sessionID, limit, before })
    })
    const items = (response.data ?? []).filter((item) => !!item?.info?.id)
    return {
      session: items.map((item) => cleanMessage(item.info)).sort(compareMessages),
      part: items.map((item) => ({
        id: item.info.id,
        part: item.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
      })),
      source: legacyMessageSource(items),
      sourceMode: before ? ("older" as const) : ("latest" as const),
      cursor: response.response.headers.get("x-next-cursor") ?? undefined,
      complete: !response.response.headers.get("x-next-cursor"),
    }
  }

  const fetchMessage = async (sessionID: string, messageID: string, onAttempt?: () => void) => {
    if (sessionApi && (await options?.protocol) !== "v1") {
      const response = await (options?.retry ?? retry)(() => {
        onAttempt?.()
        return sessionApi.message({ sessionID, messageID })
      })
      const normalized = normalizeSessionMessages(sessionID, [response])
      const message = normalized.messages[0]
      if (!message) throw new Error(`Message not found: ${messageID}`)
      return { message, parts: normalized.parts.get(messageID) ?? [] }
    }
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.message({ sessionID, messageID })
    })
    if (!response.data?.info?.id) throw new Error(`Message not found: ${messageID}`)
    return {
      message: cleanMessage(response.data.info),
      parts: response.data.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
    }
  }

  const replaceMessages = (sessionID: string, messages: Message[]) => {
    const messageIDs = new Set(messages.map((message) => message.id))
    const dropped = (data.message[sessionID] ?? []).filter((message) => !messageIDs.has(message.id))
    setData("message", sessionID, reconcile(messages, { key: "id" }))
    setData(
      produce((draft) => {
        for (const message of dropped) deleteMessageParts(draft, message.id)
      }),
    )
    return messageIDs
  }

  const replaceParts = (
    sessionID: string,
    items: MessagePage["part"],
    messageIDs: Set<string>,
    load?: MessageLoadState,
  ) => {
    for (const item of items) {
      if (!messageIDs.has(item.id)) continue
      const fetched = load?.clearedMessageParts.has(item.id)
        ? []
        : item.part.filter((part) => !SKIP_PARTS.has(part.type))
      const fetchedIDs = new Set(fetched.map((part) => part.id))
      const pending = pendingParts.get(sessionID)?.get(item.id)
      const touched = new Set([...(load?.touchedParts.get(item.id) ?? []), ...(pending ?? [])])
      for (const part of fetched) {
        const accumulated = data.part_text_accum_delta[part.id]
        const base = deltaBases.get(part.id)?.base
        const preserveDelta =
          base !== undefined &&
          accumulated !== undefined &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.startsWith(base) &&
          accumulated.startsWith(part.text) &&
          accumulated !== part.text
        if (preserveDelta) touched.add(part.id)
        if (load?.carriedDeltaParts.get(item.id)?.has(part.id) && !preserveDelta) touched.delete(part.id)
      }
      for (const partID of load?.carriedDeltaParts.get(item.id) ?? []) {
        if (!fetchedIDs.has(partID)) touched.delete(partID)
      }
      const parts = reconcileFetched(fetched, data.part[item.id] ?? [], { touched })
      if (!parts.length) {
        orphanParts.get(sessionID)?.delete(item.id)
        setData(produce((draft) => deleteMessageParts(draft, item.id)))
        continue
      }
      const partIDs = new Set(parts.map((part) => part.id))
      setData(
        "part_text_accum_delta",
        produce((draft) => {
          for (const part of data.part[item.id] ?? []) {
            if (!partIDs.has(part.id) || !touched.has(part.id)) {
              delete draft[part.id]
              deltaBases.delete(part.id)
            }
          }
        }),
      )
      setData("part", item.id, reconcile(parts, { key: "id" }))
      orphanParts.get(sessionID)?.delete(item.id)
    }
  }

  const applyMessagePage = (
    sessionID: string,
    page: MessagePage,
    load: MessageLoadState | undefined,
    preserveUnfetched: boolean | ((message: Message) => boolean),
    cleanupOrphans: boolean,
  ) => {
    const source = page.source
      ? (() => {
          const incoming = new Map(page.source.map((message) => [message.id, message]))
          const existing = data.session_message[sessionID] ?? []
          const current = existing.filter((message) => !incoming.has(message.id))
          const live = new Map(existing.map((message) => [message.id, message]))
          return (page.sourceMode === "older" ? [...page.source, ...current] : [...current, ...page.source]).map(
            (message) => (load?.touchedSource.has(message.id) ? (live.get(message.id) ?? message) : message),
          )
        })()
      : undefined
    const projected =
      page.projectSource && source
        ? (() => {
            const normalized = normalizeSessionMessages(sessionID, source)
            return {
              ...page,
              session: normalized.messages.sort(compareMessages),
              part: [...normalized.parts.entries()]
                .map(([id, part]) => ({ id, part: part.sort((a, b) => cmp(a.id, b.id)) }))
                .sort((a, b) => cmp(a.id, b.id)),
            }
          })()
        : page
    const merged = mergeOptimisticPage(projected, [...(optimistic.get(sessionID)?.values() ?? [])])
    merged.observed.forEach((item) => {
      if (!load?.clearedMessageParts.has(item.messageID)) confirmOptimistic(sessionID, item.messageID, item.parts)
    })
    const touchedMessages = new Set([...(load?.touchedMessages ?? []), ...(removedMessages.get(sessionID) ?? [])])
    const messages = reconcileFetched(merged.session, data.message[sessionID] ?? [], {
      touched: touchedMessages,
      retained: load?.retainedMessages,
      removed: load?.removedMessages,
      preserveUnfetched,
      compare: compareMessages,
    })
    batch(() => {
      if (source) setData("session_message", sessionID, reconcile(source))
      const messageIDs = replaceMessages(sessionID, messages)
      replaceParts(sessionID, merged.part, messageIDs, load)
      const orphans = orphanParts.get(sessionID)
      if (cleanupOrphans && page.complete && orphans) {
        for (const messageID of orphans) {
          if (!messageIDs.has(messageID)) setData(produce((draft) => deleteMessageParts(draft, messageID)))
        }
        orphanParts.delete(sessionID)
      }
      setMeta("limit", sessionID, messages.length)
      setMeta("cursor", sessionID, merged.cursor)
      setMeta("complete", sessionID, merged.complete)
      setMeta("at", sessionID, Date.now())
    })
  }

  const loadMessages = async (sessionID: string, limit: number, before?: string, mode?: "replace" | "prepend") => {
    if (meta.loading[sessionID]) return
    const active = generation(sessionID)
    const load: MessageLoadState = {
      touchedMessages: new Set(),
      removedMessages: new Set(),
      retainedMessages: new Set(),
      touchedParts: new Map(),
      deltaParts: new Map(),
      carriedDeltaParts: new Map(),
      removedParts: new Map(),
      optimisticParts: new Map(),
      orphanParents: new Set(),
      clearedMessageParts: new Set(),
      touchedSource: new Set(),
    }
    messageLoads.set(sessionID, load)
    setMeta("loading", sessionID, true)
    let applied = false
    try {
      const page = await fetchMessages(sessionID, limit, before, () => resetMessageLoad(sessionID, load))
      const first = page.session.reduce<Message | undefined>(
        (oldest, message) => (!oldest || compareMessages(message, oldest) < 0 ? message : oldest),
        undefined,
      )
      if (generations.get(sessionID) !== active) return

      const parents = [] as Awaited<ReturnType<typeof fetchMessage>>[]
      if (mode !== "prepend") {
        const users = new Set([
          ...page.session.filter((message) => message.role === "user").map((message) => message.id),
          ...(data.message[sessionID] ?? [])
            .filter((message) => {
              if (message.role !== "user") return false
              const item = optimistic.get(sessionID)?.get(message.id)
              return load.touchedMessages.has(message.id) && (!item || item.confirmedMessage === true)
            })
            .map((message) => message.id),
        ])
        const parentIDs = [
          ...new Set(
            page.session.flatMap((message) =>
              message.role === "assistant" && !users.has(message.parentID) ? [message.parentID] : [],
            ),
          ),
        ]
        for (const parentID of parentIDs) {
          if (generations.get(sessionID) !== active) break
          const parent = await fetchMessage(sessionID, parentID, () =>
            resetMessageLoad(sessionID, load, messageLoadBaseline(load, parentID)),
          ).catch((error) => {
            const cause = error instanceof Error && typeof error.cause === "object" ? error.cause : undefined
            if (cause && "status" in cause && cause.status === 404) {
              load.removedMessages.add(parentID)
              return
            }
            throw error
          })
          if (!parent) continue
          if (parent.message.role !== "user") throw new Error(`Assistant parent is not a user message: ${parentID}`)
          parents.push(parent)
        }
      }
      if (generations.get(sessionID) !== active) return
      const result =
        mode === "prepend"
          ? page
          : {
              ...page,
              session: merge(
                page.session,
                parents.map((parent) => parent.message),
              ).sort(compareMessages),
              part: merge(
                page.part,
                parents.map((parent) => ({ id: parent.message.id, part: parent.parts })),
              ),
            }
      const preserveUnfetched =
        mode === "prepend" ||
        (!result.complete && (!first || ((message: Message) => compareMessages(message, first) < 0)))
      applyMessagePage(
        sessionID,
        result,
        messageLoads.get(sessionID) === load ? load : undefined,
        preserveUnfetched,
        mode !== "prepend",
      )
      applied = true
    } finally {
      if (!applied && generations.get(sessionID) === active && messageLoads.get(sessionID) === load) {
        for (const messageID of load.orphanParents) {
          if (!orphanParts.get(sessionID)?.has(messageID)) continue
          setData(produce((draft) => deleteMessageParts(draft, messageID)))
          orphanParts.get(sessionID)?.delete(messageID)
        }
        if (orphanParts.get(sessionID)?.size === 0) orphanParts.delete(sessionID)
      }
      if (messageLoads.get(sessionID) === load) messageLoads.delete(sessionID)
      if (generations.get(sessionID) === active) setMeta("loading", sessionID, false)
    }
  }

  return { fetchMessages, fetchMessage, applyMessagePage, loadMessages }
}
