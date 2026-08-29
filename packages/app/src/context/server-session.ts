import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import type { OpenCodeEvent, SessionApi, SessionMessageInfo } from "@opencode-ai/client/promise"
import type {
  Message,
  OpencodeClient,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { batch } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { message as cleanMessage } from "@/utils/diffs"
import { sessionNotFoundError } from "@/utils/server-errors"
import { rootSession } from "@/utils/session-route"
import { normalizeSessionInfo } from "@/utils/session"
import { compareMessages, normalizeSessionMessages } from "@/utils/session-message"
import { dropSessionCaches, pickSessionCacheEvictions, SESSION_CACHE_LIMIT } from "./global-sync/session-cache"
import { createV2SessionReducer, type V2SessionReduction } from "./server-session-v2-reducer"
import { createLegacyEventApplier } from "@/context/server-session-events"
import { createMessageLoader } from "@/context/server-session-messages"
import { createOptimisticUpdates } from "@/context/server-session-optimistic"
import {
  cmp,
  legacyMessageSource,
  merge,
  runInflight,
  SKIP_PARTS,
  type MessageLoadState,
  type OptimisticItem,
} from "@/context/server-session-helpers"
import type { ServerApi } from "@/utils/server"

type MessageApi = ServerApi["message"]

const initialMessagePageSize = 20
const historyMessagePageSize = 200
const sessionInfoLimit = 2_048

type ServerSessionOptions = { retry?: typeof retry; protocol?: Promise<"v1" | "v2"> }

export function createServerSession(
  client: OpencodeClient,
  sessionApiOrOptions?: SessionApi | ServerSessionOptions,
  messageApi?: MessageApi,
  currentOptions?: ServerSessionOptions,
) {
  const sessionApi = messageApi ? (sessionApiOrOptions as SessionApi) : undefined
  const options = messageApi ? currentOptions : (sessionApiOrOptions as ServerSessionOptions | undefined)
  const [data, setData] = createStore({
    info: {} as Record<string, Session | undefined>,
    session_status: {} as Record<string, SessionStatus>,
    session_diff: {} as Record<string, FileDiffInfo[]>,
    todo: {} as Record<string, Todo[]>,
    permission: {} as Record<string, PermissionRequest[]>,
    question: {} as Record<string, QuestionRequest[]>,
    message: {} as Record<string, Message[]>,
    session_message: {} as Record<string, SessionMessageInfo[]>,
    part: {} as Record<string, Part[]>,
    part_text_accum_delta: {} as Record<string, string>,
    session_working(id: string) {
      return (this.session_status[id]?.type ?? "idle") !== "idle"
    },
  })
  const requests = new Map<string, Promise<Session>>()
  const inflight = new Map<string, Promise<void>>()
  const inflightTodo = new Map<string, Promise<void>>()
  const optimistic = new Map<string, Map<string, OptimisticItem>>()
  const v2 = createV2SessionReducer()
  const messageLoads = new Map<string, MessageLoadState>()
  const pendingParts = new Map<string, Map<string, Set<string>>>()
  const orphanParts = new Map<string, Set<string>>()
  const removedMessages = new Map<string, Set<string>>()
  const deltaBases = new Map<string, { base: string; sessionID: string }>()
  const deleteMessageParts = (
    cache: { part: Record<string, Part[] | undefined>; part_text_accum_delta: Record<string, string | undefined> },
    messageID: string,
  ) => {
    for (const part of cache.part[messageID] ?? []) {
      delete cache.part_text_accum_delta[part.id]
      deltaBases.delete(part.id)
    }
    delete cache.part[messageID]
  }
  const seen = new Set<string>()
  const infoSeen = new Set<string>()
  const pinned = new Map<string, number>()
  const generations = new Map<string, object>()
  const generation = (sessionID: string) => {
    const current = generations.get(sessionID)
    if (current) return current
    const created = {}
    generations.set(sessionID, created)
    return created
  }
  const [meta, setMeta] = createStore({
    limit: {} as Record<string, number | undefined>,
    cursor: {} as Record<string, string | undefined>,
    complete: {} as Record<string, boolean | undefined>,
    loading: {} as Record<string, boolean | undefined>,
    at: {} as Record<string, number | undefined>,
  })

  const indexLegacyMessage = (message: Message) => {
    const current = data.session_message[message.sessionID] ?? []
    if (current.some((item) => item.id === message.id)) return
    setData(
      "session_message",
      message.sessionID,
      reconcile([...current, ...legacyMessageSource([{ info: message, parts: [] }])]),
    )
  }

  const remember = (session: Session) => {
    setData("info", session.id, reconcile(session))
    infoSeen.delete(session.id)
    infoSeen.add(session.id)
    if (infoSeen.size > sessionInfoLimit) {
      const preserve = new Set([
        ...pinned.keys(),
        ...requests.keys(),
        ...inflight.keys(),
        ...inflightTodo.keys(),
        ...messageLoads.keys(),
        ...optimistic.keys(),
        ...Object.entries(data.permission)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.question)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.session_status)
          .filter(([, status]) => status.type !== "idle")
          .map(([sessionID]) => sessionID),
      ])
      for (const sessionID of preserve) {
        let current = data.info[sessionID]
        while (current) {
          preserve.add(current.id)
          current = current.parentID ? data.info[current.parentID] : undefined
        }
      }
      const stale: string[] = []
      for (const sessionID of infoSeen) {
        if (infoSeen.size - stale.length <= sessionInfoLimit) break
        if (!preserve.has(sessionID)) stale.push(sessionID)
      }
      stale.forEach((sessionID) => infoSeen.delete(sessionID))
      stale.forEach((sessionID) => generations.delete(sessionID))
      setData(
        "info",
        produce((draft) => stale.forEach((sessionID) => delete draft[sessionID])),
      )
    }
    return session
  }

  const resolve = (sessionID: string, options?: { force?: boolean }) => {
    const cached = data.info[sessionID]
    if (cached && !options?.force) return Promise.resolve(cached)
    const pending = requests.get(sessionID)
    if (pending) return pending
    const active = generation(sessionID)
    const request = sessionApi
      ? sessionApi.get({ sessionID }).then(normalizeSessionInfo)
      : client.session.get({ sessionID }).then((result) => {
          if (!result.data) throw sessionNotFoundError(sessionID)
          return result.data
        })
    const resolved = request.then((result) => {
      if (generations.get(sessionID) !== active) return result
      return remember(result)
    })
    requests.set(sessionID, resolved)
    const cleanup = () => {
      if (requests.get(sessionID) === resolved) requests.delete(sessionID)
      if (
        generations.get(sessionID) === active &&
        !data.info[sessionID] &&
        !requests.has(sessionID) &&
        !messageLoads.has(sessionID) &&
        !inflight.has(sessionID) &&
        !inflightTodo.has(sessionID)
      )
        generations.delete(sessionID)
    }
    void resolved.then(cleanup, cleanup)
    return resolved
  }

  const peekLineage = (sessionID: string) => {
    const session = data.info[sessionID]
    if (!session) return
    const seen = new Set([session.id])
    let root = session
    while (root.parentID) {
      if (seen.has(root.parentID)) throw new Error(`Session parent cycle: ${root.parentID}`)
      seen.add(root.parentID)
      const parent = data.info[root.parentID]
      if (!parent) return
      root = parent
    }
    return { session, root }
  }

  const { clearOptimistic, clearOptimisticPart, confirmOptimisticPart, confirmOptimistic, add, remove } =
    createOptimisticUpdates({
      data,
      setData: setData as unknown as SetStoreFunction<Parameters<typeof createOptimisticUpdates>[0]["data"]>,
      optimistic,
      messageLoads,
      removedMessages,
      deltaBases,
      deleteMessageParts,
    })

  const trackPartChange = (sessionID: string, messageID: string, partID: string) => {
    const load = messageLoads.get(sessionID)
    if (!load) return
    // A part event keeps an existing parent when the fetched page omits it without overriding fetched metadata.
    const messages = data.message[sessionID]
    if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    const parts = load.touchedParts.get(messageID)
    if (parts) {
      parts.add(partID)
      return
    }
    load.touchedParts.set(messageID, new Set([partID]))
  }

  const evict = (sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    const evicted = new Set(sessionIDs)
    for (const [partID, item] of deltaBases) {
      if (evicted.has(item.sessionID)) deltaBases.delete(partID)
    }
    sessionIDs.forEach((sessionID) => {
      generations.delete(sessionID)
      clearOptimistic(sessionID)
      requests.delete(sessionID)
      inflight.delete(sessionID)
      inflightTodo.delete(sessionID)
      messageLoads.delete(sessionID)
      v2.clear(sessionID)
      pendingParts.delete(sessionID)
      orphanParts.delete(sessionID)
      removedMessages.delete(sessionID)
    })
    setData(
      produce((draft) => {
        dropSessionCaches(draft, sessionIDs)
      }),
    )
    setMeta(
      produce((draft) => {
        for (const sessionID of sessionIDs) {
          delete draft.limit[sessionID]
          delete draft.cursor[sessionID]
          delete draft.complete[sessionID]
          delete draft.loading[sessionID]
          delete draft.at[sessionID]
        }
      }),
    )
  }

  const protectedSessions = () =>
    new Set([
      ...pinned.keys(),
      ...requests.keys(),
      ...inflight.keys(),
      ...inflightTodo.keys(),
      ...messageLoads.keys(),
      ...optimistic.keys(),
      ...Object.entries(data.permission)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.question)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.session_status)
        .filter(([, status]) => status.type !== "idle")
        .map(([sessionID]) => sessionID),
    ])

  const touch = (sessionID: string) =>
    evict(
      pickSessionCacheEvictions({ seen, keep: sessionID, limit: SESSION_CACHE_LIMIT, preserve: protectedSessions() }),
    )

  const { loadMessages } = createMessageLoader({
    client,
    sessionApi,
    messageApi,
    options,
    data,
    setData: setData as unknown as SetStoreFunction<Parameters<typeof createMessageLoader>[0]["data"]>,
    meta,
    setMeta,
    messageLoads,
    pendingParts,
    orphanParts,
    deltaBases,
    optimistic,
    removedMessages,
    generations,
    generation,
    deleteMessageParts,
    confirmOptimistic,
  })

  const sync = (sessionID: string, options?: { force?: boolean; messageLimit?: number }) => {
    touch(sessionID)
    return runInflight(inflight, sessionID, async () => {
      const cached = data.message[sessionID] !== undefined && meta.limit[sessionID] !== undefined
      if (cached && data.info[sessionID] && !options?.force) return
      await Promise.all([
        resolve(sessionID, options),
        cached && !options?.force
          ? Promise.resolve()
          : loadMessages(sessionID, options?.messageLimit ?? meta.limit[sessionID] ?? initialMessagePageSize),
      ])
    })
  }

  const prefetch = async (sessionID: string, limit: number) => {
    touch(sessionID)
    await inflight.get(sessionID)
    if (
      Date.now() - (meta.at[sessionID] ?? 0) <= 15_000 &&
      (meta.complete[sessionID] || (data.message[sessionID]?.length ?? 0) >= limit)
    )
      return
    await runInflight(inflight, sessionID, () => loadMessages(sessionID, limit))
  }

  const projectV2 = (reduction: V2SessionReduction) => {
    reduction.touched.forEach((messageID) => messageLoads.get(reduction.sessionID)?.touchedSource.add(messageID))
    setData("session_message", reduction.sessionID, reconcile(reduction.messages))
    if (reduction.touched.length === 0) return

    const touched = new Set(reduction.touched)
    let parentID: string | undefined
    for (const message of reduction.messages) {
      if (message.type === "user" || (message.type === "synthetic" && message.description?.trim()))
        parentID = message.id
      if (message.type === "shell") {
        if (touched.has(message.id)) touched.add(`${message.id}:assistant`)
        parentID = undefined
      }
      if (message.type === "assistant" && touched.has(message.id) && parentID) touched.add(parentID)
      if (message.type === "compaction" && touched.has(message.id) && parentID) touched.add(parentID)
    }

    const normalized = normalizeSessionMessages(reduction.sessionID, reduction.messages)
    batch(() => {
      for (const message of normalized.messages) {
        if (!touched.has(message.id)) continue
        apply({ type: "message.updated", properties: { sessionID: reduction.sessionID, info: message } })
      }
      for (const messageID of touched) {
        const next = normalized.parts.get(messageID) ?? []
        const nextIDs = new Set(next.map((part) => part.id))
        for (const part of next) {
          apply({ type: "message.part.updated", properties: { sessionID: reduction.sessionID, part } })
        }
        for (const part of data.part[messageID] ?? []) {
          if (nextIDs.has(part.id)) continue
          apply({
            type: "message.part.removed",
            properties: { sessionID: reduction.sessionID, messageID, partID: part.id },
          })
        }
      }
    })
  }

  const hydrateV2Message = (sessionID: string, messageID: string) => {
    if (!sessionApi) return
    void sessionApi
      .message({ sessionID, messageID })
      .then((message) => {
        const current = data.session_message[sessionID] ?? []
        const messages = [...current.filter((item) => item.id !== message.id), message].sort(compareMessages)
        projectV2({ sessionID, messages, touched: [message.id] })
      })
      .catch(() => {})
  }

  const applyV2 = (event: OpenCodeEvent) => {
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    const reduction = v2.reduce(data.session_message[sessionID] ?? [], event)
    if (reduction) {
      projectV2(reduction)
      if (reduction.missing) hydrateV2Message(sessionID, reduction.missing)
    }

    const info = data.info[sessionID]
    if (event.type === "session.renamed" && info)
      remember({ ...info, title: event.data.title, time: { ...info.time, updated: event.created } })
    if (event.type === "session.moved" && info)
      remember({
        ...info,
        projectID: event.data.projectID ?? info.projectID,
        workspaceID: event.data.location.workspaceID,
        directory: event.data.location.directory,
        path: event.data.subpath,
        time: { ...info.time, updated: event.created },
      })
    if (event.type === "session.usage.updated" && info)
      remember({ ...info, cost: event.data.cost, tokens: event.data.tokens })
    // if (event.type === "session.archived") {
    //   if (info) remember({ ...info, time: { ...info.time, archived: event.created, updated: event.created } })
    //   evict([sessionID])
    // }
    if (event.type === "session.execution.started") setData("session_status", sessionID, { type: "busy" })
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    )
      setData("session_status", sessionID, { type: "idle" })
    if (event.type === "session.retry.scheduled")
      setData("session_status", sessionID, {
        type: "retry",
        attempt: event.data.attempt,
        message: event.data.error.message,
        next: event.data.at,
      })
    if (event.type === "session.forked") void resolve(sessionID, { force: true }).catch(() => {})
    if (
      event.type === "session.revert.staged" ||
      event.type === "session.revert.cleared" ||
      event.type === "session.revert.committed"
    )
      void resolve(sessionID, { force: true }).catch(() => {})
  }

  const apply = createLegacyEventApplier({
    data,
    setData,
    messageLoads,
    optimistic,
    orphanParts,
    removedMessages,
    pendingParts,
    deltaBases,
    touch,
    resolve,
    remember,
    evict,
    indexLegacyMessage,
    clearOptimistic,
    clearOptimisticPart,
    confirmOptimisticPart,
    trackPartChange,
    deleteMessageParts,
  })

  return {
    data,
    set: setData,
    get: (sessionID: string) => data.info[sessionID],
    peek: (sessionID: string) => data.info[sessionID],
    remember,
    resolve,
    lineage: {
      peek: peekLineage,
      async resolve(sessionID: string) {
        const session = await resolve(sessionID)
        return { session, root: await rootSession(session, resolve) }
      },
    },
    sync,
    prefetch,
    shouldPrefetch(sessionID: string, limit: number) {
      if (data.message[sessionID] === undefined) return true
      if (Date.now() - (meta.at[sessionID] ?? 0) > 15_000) return true
      if (meta.complete[sessionID]) return false
      return (meta.limit[sessionID] ?? 0) <= limit
    },
    fresh(sessionID: string, ttl: number) {
      return Date.now() - (meta.at[sessionID] ?? 0) <= ttl
    },
    optimistic: { add, remove },
    async todo(sessionID: string, request?: { force?: boolean }) {
      touch(sessionID)
      if (data.todo[sessionID] !== undefined && !request?.force) return
      if ((await options?.protocol) === "v2") {
        setData("todo", sessionID, [])
        return
      }
      return runInflight(inflightTodo, sessionID, () => {
        const active = generation(sessionID)
        return (options?.retry ?? retry)(() => client.session.todo({ sessionID })).then((result) => {
          if (generations.get(sessionID) !== active) return
          setData("todo", sessionID, reconcile(result.data ?? [], { key: "id" }))
        })
      })
    },
    history: {
      more: (sessionID: string) =>
        data.message[sessionID] !== undefined &&
        meta.limit[sessionID] !== undefined &&
        !meta.complete[sessionID] &&
        !!meta.cursor[sessionID],
      loading: (sessionID: string) => meta.loading[sessionID] ?? false,
      async loadMore(sessionID: string, count = historyMessagePageSize) {
        touch(sessionID)
        if (meta.loading[sessionID] || meta.complete[sessionID] || !meta.cursor[sessionID]) return
        await loadMessages(sessionID, count, meta.cursor[sessionID], "prepend")
      },
    },
    evict(sessionID: string) {
      if (protectedSessions().has(sessionID)) return
      seen.delete(sessionID)
      evict([sessionID])
    },
    pin(sessionID: string) {
      pinned.set(sessionID, (pinned.get(sessionID) ?? 0) + 1)
      touch(sessionID)
    },
    unpin(sessionID: string) {
      const count = pinned.get(sessionID)
      if (!count || count === 1) pinned.delete(sessionID)
      if (count && count > 1) pinned.set(sessionID, count - 1)
    },
    apply,
    applyV2,
  }
}

export type ServerSession = ReturnType<typeof createServerSession>
