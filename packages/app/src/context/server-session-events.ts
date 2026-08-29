import { Binary } from "@opencode-ai/core/util/binary"
import type { Message, Part, PermissionRequest, QuestionRequest, Session, SessionStatus, Todo } from "@opencode-ai/sdk/v2/client"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { produce, reconcile } from "solid-js/store"
import { message as cleanMessage } from "@/utils/diffs"
import { messageKey } from "@/utils/session-message"
import { SKIP_PARTS, type MessageLoadState, type OptimisticItem } from "@/context/server-session-helpers"

type EventStoreData = {
  info: Record<string, Session | undefined>
  session_status: Record<string, SessionStatus>
  todo: Record<string, Todo[]>
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  message: Record<string, Message[]>
  session_message: Record<string, SessionMessageInfo[]>
  part: Record<string, Part[]>
  part_text_accum_delta: Record<string, string>
}

type DeleteMessageParts = (
  cache: { part: Record<string, Part[] | undefined>; part_text_accum_delta: Record<string, string | undefined> },
  messageID: string,
) => void

export function eventSessionID(event: { type: string; properties?: unknown }) {
  const properties = event.properties
  if (!properties || typeof properties !== "object") return
  if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID
  if (
    "info" in properties &&
    properties.info &&
    typeof properties.info === "object" &&
    "sessionID" in properties.info &&
    typeof properties.info.sessionID === "string"
  )
    return properties.info.sessionID
  if (
    "part" in properties &&
    properties.part &&
    typeof properties.part === "object" &&
    "sessionID" in properties.part &&
    typeof properties.part.sessionID === "string"
  )
    return properties.part.sessionID
}

export function createLegacyEventApplier(deps: {
  data: EventStoreData
  // solid-js store setters are heavily overloaded; typed loosely here to keep this module decoupled from the store shape.
  setData: (...args: any[]) => void
  messageLoads: Map<string, MessageLoadState>
  optimistic: Map<string, Map<string, OptimisticItem>>
  orphanParts: Map<string, Set<string>>
  removedMessages: Map<string, Set<string>>
  pendingParts: Map<string, Map<string, Set<string>>>
  deltaBases: Map<string, { base: string; sessionID: string }>
  touch: (sessionID: string) => void
  resolve: (sessionID: string, options?: { force?: boolean }) => Promise<Session>
  remember: (session: Session) => Session
  evict: (sessionIDs: string[]) => void
  indexLegacyMessage: (message: Message) => void
  clearOptimistic: (sessionID: string, messageID?: string) => void
  clearOptimisticPart: (sessionID: string, messageID: string, partID: string) => void
  confirmOptimisticPart: (sessionID: string, messageID: string, part: Part) => void
  trackPartChange: (sessionID: string, messageID: string, partID: string) => void
  deleteMessageParts: DeleteMessageParts
}) {
  const { data, setData, messageLoads, optimistic, orphanParts, removedMessages, pendingParts, deltaBases } = deps

  return function apply(event: { type: string; properties?: unknown }) {
    const eventID = eventSessionID(event)
    if (eventID) {
      deps.touch(eventID)
      if (
        !data.info[eventID] &&
        event.type !== "session.created" &&
        event.type !== "session.updated" &&
        event.type !== "session.deleted"
      )
        void deps.resolve(eventID).catch(() => {})
    }
    switch (event.type) {
      case "session.created":
        deps.remember((event.properties as { info: Session }).info)
        return
      case "session.updated": {
        const info = (event.properties as { info: Session }).info
        deps.remember(info)
        if (info.time.archived) deps.evict([info.id])
        return
      }
      case "session.deleted": {
        const properties = event.properties as { sessionID?: string; info?: Session }
        const sessionID = properties.info?.id ?? properties.sessionID
        if (!sessionID) return
        setData(
          "info",
          produce((draft: Record<string, Session | undefined>) => void delete draft[sessionID]),
        )
        deps.evict([sessionID])
        return
      }
      case "todo.updated": {
        const props = event.properties as { sessionID: string; todos: Todo[] }
        setData("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
        return
      }
      case "session.status": {
        const props = event.properties as { sessionID: string; status: SessionStatus }
        setData("session_status", props.sessionID, reconcile(props.status))
        return
      }
      case "message.updated": {
        const info = cleanMessage((event.properties as { info: Message }).info)
        deps.indexLegacyMessage(info)
        const load = messageLoads.get(info.sessionID)
        load?.touchedMessages.add(info.id)
        load?.removedMessages.delete(info.id)
        const items = optimistic.get(info.sessionID)
        const item = items?.get(info.id)
        if (items && item) {
          if (item.parts.length === 0) deps.clearOptimistic(info.sessionID, info.id)
          if (item.parts.length > 0) items.set(info.id, { ...item, confirmedMessage: true })
        }
        const orphans = orphanParts.get(info.sessionID)
        orphans?.delete(info.id)
        if (orphans?.size === 0) orphanParts.delete(info.sessionID)
        const removedMessagesForSession = removedMessages.get(info.sessionID)
        removedMessagesForSession?.delete(info.id)
        if (removedMessagesForSession?.size === 0) removedMessages.delete(info.sessionID)
        const messages = data.message[info.sessionID]
        if (!messages) {
          setData("message", info.sessionID, [info])
          return
        }
        const result = Binary.search(messages, messageKey(info), messageKey)
        if (result.found) setData("message", info.sessionID, result.index, reconcile(info))
        if (!result.found)
          setData("message", info.sessionID, (value: Message[] = []) => {
            const next = value.slice()
            next.splice(result.index, 0, info)
            return next
          })
        return
      }
      case "message.removed": {
        const props = event.properties as { sessionID: string; messageID: string }
        setData("session_message", props.sessionID, (messages: SessionMessageInfo[] | undefined) =>
          messages?.filter((message) => message.id !== props.messageID),
        )
        const load = messageLoads.get(props.sessionID)
        load?.touchedMessages.add(props.messageID)
        load?.removedMessages.add(props.messageID)
        load?.clearedMessageParts.add(props.messageID)
        load?.deltaParts.delete(props.messageID)
        load?.carriedDeltaParts.delete(props.messageID)
        load?.removedParts.delete(props.messageID)
        load?.optimisticParts.delete(props.messageID)
        pendingParts.get(props.sessionID)?.delete(props.messageID)
        if (pendingParts.get(props.sessionID)?.size === 0) pendingParts.delete(props.sessionID)
        const removedMessagesForSession = removedMessages.get(props.sessionID) ?? new Set<string>()
        removedMessagesForSession.add(props.messageID)
        removedMessages.set(props.sessionID, removedMessagesForSession)
        deps.clearOptimistic(props.sessionID, props.messageID)
        setData(
          produce((draft: { message: Record<string, Message[] | undefined> } & Parameters<DeleteMessageParts>[0]) => {
            const messages = draft.message[props.sessionID]
            if (messages) {
              const index = messages.findIndex((message) => message.id === props.messageID)
              if (index >= 0) messages.splice(index, 1)
            }
            deps.deleteMessageParts(draft, props.messageID)
          }),
        )
        return
      }
      case "message.part.updated": {
        const part = (event.properties as { part: Part }).part
        if (SKIP_PARTS.has(part.type)) return
        const messages = data.message[part.sessionID]
        const load = messageLoads.get(part.sessionID)
        const missing = !messages?.some((message) => message.id === part.messageID)
        // Outside a page load, accepting a part without its ordered parent event would create an unbounded orphan.
        if (
          missing &&
          (!load ||
            load.clearedMessageParts.has(part.messageID) ||
            removedMessages.get(part.sessionID)?.has(part.messageID))
        )
          return
        if (missing) {
          const orphans = orphanParts.get(part.sessionID) ?? new Set<string>()
          orphans.add(part.messageID)
          orphanParts.set(part.sessionID, orphans)
          load?.orphanParents.add(part.messageID)
        }
        const deltas = load?.deltaParts.get(part.messageID)
        deltas?.delete(part.id)
        if (deltas?.size === 0) load?.deltaParts.delete(part.messageID)
        const carried = load?.carriedDeltaParts.get(part.messageID)
        carried?.delete(part.id)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(part.messageID)
        const removed = load?.removedParts.get(part.messageID)
        removed?.delete(part.id)
        if (removed?.size === 0) load?.removedParts.delete(part.messageID)
        const pending = pendingParts.get(part.sessionID)?.get(part.messageID)
        pending?.delete(part.id)
        if (pending?.size === 0) pendingParts.get(part.sessionID)?.delete(part.messageID)
        if (pendingParts.get(part.sessionID)?.size === 0) pendingParts.delete(part.sessionID)
        const optimisticParts = load?.optimisticParts.get(part.messageID)
        optimisticParts?.delete(part.id)
        if (optimisticParts?.size === 0) load?.optimisticParts.delete(part.messageID)
        deltaBases.delete(part.id)
        deps.trackPartChange(part.sessionID, part.messageID, part.id)
        deps.confirmOptimisticPart(part.sessionID, part.messageID, part)
        setData(
          "part_text_accum_delta",
          produce((draft: Record<string, string | undefined>) => void delete draft[part.id]),
        )
        const parts = data.part[part.messageID]
        if (!parts) {
          setData("part", part.messageID, [part])
          return
        }
        const result = Binary.search(parts, part.id, (item) => item.id)
        if (result.found) setData("part", part.messageID, result.index, reconcile(part))
        if (!result.found)
          setData("part", part.messageID, (value: Part[] = []) => {
            const next = value.slice()
            next.splice(result.index, 0, part)
            return next
          })
        return
      }
      case "message.part.removed": {
        const props = event.properties as { sessionID: string; messageID: string; partID: string }
        // Part removal is event-only on the server, so its tombstone lasts until a later update or eviction.
        const pending = pendingParts.get(props.sessionID) ?? new Map<string, Set<string>>()
        const parts = pending.get(props.messageID) ?? new Set<string>()
        parts.add(props.partID)
        pending.set(props.messageID, parts)
        pendingParts.set(props.sessionID, pending)
        const deltas = messageLoads.get(props.sessionID)?.deltaParts.get(props.messageID)
        deltas?.delete(props.partID)
        if (deltas?.size === 0) messageLoads.get(props.sessionID)?.deltaParts.delete(props.messageID)
        const load = messageLoads.get(props.sessionID)
        const carried = load?.carriedDeltaParts.get(props.messageID)
        carried?.delete(props.partID)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(props.messageID)
        if (load) {
          const removedPartsSet = load.removedParts.get(props.messageID) ?? new Set<string>()
          removedPartsSet.add(props.partID)
          load.removedParts.set(props.messageID, removedPartsSet)
          const optimisticParts = load.optimisticParts.get(props.messageID)
          optimisticParts?.delete(props.partID)
          if (optimisticParts?.size === 0) load.optimisticParts.delete(props.messageID)
        }
        deps.trackPartChange(props.sessionID, props.messageID, props.partID)
        deps.clearOptimisticPart(props.sessionID, props.messageID, props.partID)
        setData(
          produce(
            (draft: {
              part_text_accum_delta: Record<string, string | undefined>
              part: Record<string, Part[] | undefined>
            }) => {
              delete draft.part_text_accum_delta[props.partID]
              deltaBases.delete(props.partID)
              const parts = draft.part[props.messageID]
              if (!parts) return
              const result = Binary.search(parts, props.partID, (part) => part.id)
              if (result.found) parts.splice(result.index, 1)
              if (parts.length === 0) delete draft.part[props.messageID]
            },
          ),
        )
        return
      }
      case "message.part.delta": {
        const props = event.properties as {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
        const parts = data.part[props.messageID]
        if (!parts) return
        const result = Binary.search(parts, props.partID, (part) => part.id)
        if (!result.found) return
        deps.trackPartChange(props.sessionID, props.messageID, props.partID)
        const load = messageLoads.get(props.sessionID)
        if (load) {
          const deltaParts = load.deltaParts.get(props.messageID) ?? new Set<string>()
          deltaParts.add(props.partID)
          load.deltaParts.set(props.messageID, deltaParts)
          const carried = load.carriedDeltaParts.get(props.messageID)
          carried?.delete(props.partID)
          if (carried?.size === 0) load.carriedDeltaParts.delete(props.messageID)
        }
        const field = props.field as keyof (typeof parts)[number]
        const current = parts[result.index]?.[field]
        if (!deltaBases.has(props.partID) && typeof current === "string")
          deltaBases.set(props.partID, { base: current, sessionID: props.sessionID })
        setData(
          "part_text_accum_delta",
          props.partID,
          (value: string | undefined) => (value ?? (typeof current === "string" ? current : "")) + props.delta,
        )
        setData(
          "part",
          props.messageID,
          produce((draft: Part[] | undefined) => {
            if (!draft) return
            const part = draft[result.index]
            const field = props.field as keyof typeof part
            ;(part[field] as string) = ((part[field] as string | undefined) ?? "") + props.delta
          }),
        )
        return
      }
      case "permission.asked": {
        const permission = event.properties as PermissionRequest
        const permissions = data.permission[permission.sessionID]
        if (!permissions) {
          setData("permission", permission.sessionID, [permission])
          return
        }
        const result = Binary.search(permissions, permission.id, (item) => item.id)
        if (result.found) setData("permission", permission.sessionID, result.index, reconcile(permission))
        if (!result.found)
          setData(
            "permission",
            permission.sessionID,
            produce((draft: PermissionRequest[]) => void draft.splice(result.index, 0, permission)),
          )
        return
      }
      case "permission.replied": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "permission",
          props.sessionID,
          produce((draft: PermissionRequest[] | undefined) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
        return
      }
      case "question.asked": {
        const question = event.properties as QuestionRequest
        const questions = data.question[question.sessionID]
        if (!questions) {
          setData("question", question.sessionID, [question])
          return
        }
        const result = Binary.search(questions, question.id, (item) => item.id)
        if (result.found) setData("question", question.sessionID, result.index, reconcile(question))
        if (!result.found)
          setData(
            "question",
            question.sessionID,
            produce((draft: QuestionRequest[]) => void draft.splice(result.index, 0, question)),
          )
        return
      }
      case "question.replied":
      case "question.rejected": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "question",
          props.sessionID,
          produce((draft: QuestionRequest[] | undefined) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
      }
    }
  }
}
