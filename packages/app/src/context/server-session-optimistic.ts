import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { produce, type SetStoreFunction } from "solid-js/store"
import { cmp, merge, SKIP_PARTS, type MessageLoadState, type OptimisticItem } from "@/context/server-session-helpers"
import { compareMessages } from "@/utils/session-message"

type StoreData = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
  part_text_accum_delta: Record<string, string | undefined>
}

export function createOptimisticUpdates(input: {
  data: StoreData
  setData: SetStoreFunction<StoreData>
  optimistic: Map<string, Map<string, OptimisticItem>>
  messageLoads: Map<string, MessageLoadState>
  removedMessages: Map<string, Set<string>>
  deltaBases: Map<string, { base: string; sessionID: string }>
  deleteMessageParts: (
    cache: { part: Record<string, Part[] | undefined>; part_text_accum_delta: Record<string, string | undefined> },
    messageID: string,
  ) => void
}) {
  const { data, setData, optimistic, messageLoads, removedMessages, deltaBases, deleteMessageParts } = input

  const clearOptimistic = (sessionID: string, messageID?: string) => {
    if (!messageID) {
      optimistic.delete(sessionID)
      return
    }
    const items = optimistic.get(sessionID)
    if (!items) return
    items.delete(messageID)
    if (items.size === 0) optimistic.delete(sessionID)
  }

  const clearOptimisticPart = (sessionID: string, messageID: string, partID: string) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((part) => part.id !== partID)
    const confirmedParts = item.confirmedParts?.filter((part) => part.id !== partID)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, { ...item, parts, confirmedParts, confirmedMessage: true })
  }

  const confirmOptimisticPart = (sessionID: string, messageID: string, part: Part) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((value) => value.id !== part.id)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], [part]),
      confirmedMessage: true,
    })
  }

  const confirmOptimistic = (sessionID: string, messageID: string, confirmedParts: Part[]) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const confirmed = new Set(confirmedParts.map((part) => part.id))
    const parts = item.parts.filter((part) => !confirmed.has(part.id))
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], confirmedParts),
      confirmedMessage: true,
    })
  }

  const add = (input: { sessionID: string; message: Message; parts: Part[] }) => {
    const parts = input.parts
      .filter((part) => !!part?.id && !SKIP_PARTS.has(part.type))
      .sort((a, b) => cmp(a.id, b.id))
    const load = messageLoads.get(input.sessionID)
    if (load?.clearedMessageParts.has(input.message.id)) {
      const touched = load.touchedParts.get(input.message.id) ?? new Set<string>()
      parts.forEach((part) => touched.add(part.id))
      load.touchedParts.set(input.message.id, touched)
    }
    if (load) {
      load.removedMessages.delete(input.message.id)
      load.optimisticParts.set(input.message.id, new Set(parts.map((part) => part.id)))
    }
    const items = optimistic.get(input.sessionID)
    const removedMessagesForSession = removedMessages.get(input.sessionID)
    removedMessagesForSession?.delete(input.message.id)
    if (removedMessagesForSession?.size === 0) removedMessages.delete(input.sessionID)
    if (items) items.set(input.message.id, { ...input, parts, confirmedParts: [] })
    if (!items) optimistic.set(input.sessionID, new Map([[input.message.id, { ...input, parts, confirmedParts: [] }]]))
    setData("message", input.sessionID, (messages = []) => merge(messages, [input.message]).sort(compareMessages))
    setData(
      "part_text_accum_delta",
      produce((draft) => {
        for (const part of [...(data.part[input.message.id] ?? []), ...parts]) {
          delete draft[part.id]
          deltaBases.delete(part.id)
        }
      }),
    )
    setData("part", input.message.id, parts)
  }

  const remove = (input: { sessionID: string; messageID: string }) => {
    const item = optimistic.get(input.sessionID)?.get(input.messageID)
    if (!item) return
    messageLoads.get(input.sessionID)?.optimisticParts.delete(input.messageID)
    clearOptimistic(input.sessionID, input.messageID)
    if (item.confirmedMessage) {
      const partIDs = new Set(item.parts.map((part) => part.id))
      setData(
        produce((draft) => {
          for (const part of item.parts) {
            delete draft.part_text_accum_delta[part.id]
            deltaBases.delete(part.id)
          }
          const parts = draft.part[input.messageID]
          if (!parts) return
          draft.part[input.messageID] = parts.filter((part) => !partIDs.has(part.id))
          if (draft.part[input.messageID]?.length === 0) delete draft.part[input.messageID]
        }),
      )
      return
    }
    setData("message", input.sessionID, (messages) => messages?.filter((message) => message.id !== input.messageID))
    setData(produce((draft) => deleteMessageParts(draft, input.messageID)))
  }

  return { clearOptimistic, clearOptimisticPart, confirmOptimisticPart, confirmOptimistic, add, remove }
}
