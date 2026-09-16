export * as IntegrationRotation from "./rotation"

import type { Integration } from "../integration"
import type { IntegrationConnection } from "./connection"

// Process-local (not persisted) selection state for integrations with more
// than one connected account: which connection is "sticky" per integration,
// and which connections are temporarily benched after a failure (429,
// quota exhausted, banned, ...). Kept out of the database deliberately —
// cooldowns are minutes-to-hours, and the process restarting is itself a
// reasonable reset.
//
// NOTE: nothing calls `markUnavailable` yet. `pick` is wired into
// `SessionRunnerModel.resolve` so multi-account integrations round-robin
// across their connections on every request instead of always reusing the
// newest one, but reporting a request failure back here (so a 429 actually
// benches its connection) requires a hook in the request-execution layer
// that hasn't been built — that's the next piece, not part of this change.
const sticky = new Map<Integration.ID, string>()
const cooldowns = new Map<string, number>()

function connectionKey(connection: IntegrationConnection.Info): string {
  return connection.type === "credential" ? connection.id : `env:${connection.name}`
}

/** Benches a connection until `Date.now() + durationMs`. */
export function markUnavailable(connection: IntegrationConnection.Info, durationMs: number): void {
  cooldowns.set(connectionKey(connection), Date.now() + durationMs)
}

/** Clears a connection's cooldown, e.g. after it responds successfully again. */
export function clearUnavailable(connection: IntegrationConnection.Info): void {
  cooldowns.delete(connectionKey(connection))
}

function isAvailable(connection: IntegrationConnection.Info): boolean {
  const until = cooldowns.get(connectionKey(connection))
  return until === undefined || until <= Date.now()
}

/**
 * Picks which connection to use for the next request against an
 * integration. Sticks to the same connection across calls (so a
 * multi-turn conversation doesn't hop accounts mid-stream) until it's
 * benched by `markUnavailable`, at which point it advances to the next
 * available connection and remembers that one instead.
 */
export function pick(
  integrationID: Integration.ID,
  connections: readonly IntegrationConnection.Info[],
): IntegrationConnection.Info | undefined {
  if (connections.length === 0) return undefined
  const usable = connections.filter(isAvailable)
  const pool = usable.length > 0 ? usable : connections
  const stickyKey = sticky.get(integrationID)
  const kept = stickyKey ? pool.find((connection) => connectionKey(connection) === stickyKey) : undefined
  const next = kept ?? pool[0]
  sticky.set(integrationID, connectionKey(next))
  return next
}
