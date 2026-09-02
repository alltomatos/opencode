import type { OpenCodeEvent, SessionApi, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Part, Session } from "@opencode-ai/sdk/v2/client"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction } from "solid-js/store"
import { compareMessages, normalizeSessionMessages } from "@/utils/session-message"
import { createV2SessionReducer, type V2SessionReduction } from "./server-session-v2-reducer"
import type { MessageLoadState } from "@/context/server-session-helpers"

type StoreData = {
  info: Record<string, Session | undefined>
  session_message: Record<string, SessionMessageInfo[] | undefined>
  part: Record<string, Part[] | undefined>
  session_status: Record<string, unknown>
}

export function createV2Projector(input: {
  v2: ReturnType<typeof createV2SessionReducer>
  data: StoreData
  setData: SetStoreFunction<StoreData>
  messageLoads: Map<string, MessageLoadState>
  sessionApi?: SessionApi
  apply: (event: { type: string; properties: unknown }) => void
  remember: (session: Session) => Session
  resolve: (sessionID: string, options?: { force?: boolean }) => Promise<Session>
}) {
  const { v2, data, setData, messageLoads, sessionApi, apply, remember, resolve } = input

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

  return { applyV2 }
}
