import { base64Encode } from "@opencode-ai/core/util/encode"

export type AutoAcceptLevel = boolean | "edits"

const EDIT_ACTIONS = new Set(["edit"])

export function matchesAutoAcceptLevel(level: AutoAcceptLevel | undefined, permission: { permission?: string }) {
  if (level === true) return true
  if (level === "edits") return !!permission.permission && EDIT_ACTIONS.has(permission.permission)
  return false
}

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, AutoAcceptLevel>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  return autoAccept[key] ?? autoAccept[sessionID]
}

export function directoryAutoAcceptLevel(autoAccept: Record<string, AutoAcceptLevel>, directory: string) {
  return autoAccept[directoryAcceptKey(directory)]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, AutoAcceptLevel>, directory: string) {
  return directoryAutoAcceptLevel(autoAccept, directory) === true
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function sessionAutoAcceptLevel(
  autoAccept: Record<string, AutoAcceptLevel>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is AutoAcceptLevel => item !== undefined)
}

export function autoRespondsPermission(
  autoAccept: Record<string, AutoAcceptLevel>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string; permission?: string },
  directory?: string,
) {
  const level = sessionAutoAcceptLevel(autoAccept, session, permission, directory)
  const resolved = level !== undefined ? level : directory ? directoryAutoAcceptLevel(autoAccept, directory) : undefined
  return matchesAutoAcceptLevel(resolved, permission)
}

export function sessionAutoAccept(
  autoAccept: Record<string, AutoAcceptLevel>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string; permission?: string },
  directory?: string,
) {
  const level = sessionAutoAcceptLevel(autoAccept, session, permission, directory)
  if (level === undefined) return undefined
  return matchesAutoAcceptLevel(level, permission)
}
