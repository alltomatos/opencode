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

/** Whether a connection is currently outside its cooldown window, if any. */
export function isAvailable(connection: IntegrationConnection.Info): boolean {
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

/**
 * Benches the currently sticky connection for an integration ID until
 * `Date.now() + durationMs`. Returns true if a sticky connection was benched.
 */
export function markStickyUnavailable(integrationID: Integration.ID, durationMs: number): boolean {
  const currentKey = sticky.get(integrationID)
  if (!currentKey) return false
  cooldowns.set(currentKey, Date.now() + durationMs)
  return true
}

/**
 * Inspects an error (LLMError, reason, or HTTP error details) to determine if it is
 * caused by rate limiting (429), quota exhaustion, or unrecoverable auth failures.
 */
export function isBenchableFailure(error: unknown): { bench: boolean; durationMs: number } {
  if (!error || typeof error !== "object") return { bench: false, durationMs: 0 }

  const target = "reason" in error && typeof (error as any).reason === "object" ? (error as any).reason : error
  const tag = (target as any)._tag
  const status = (target as any).status ?? (target as any).http?.response?.status

  if (tag === "RateLimit" || status === 429) {
    const retryAfter =
      (target as any).retryAfterMs ??
      (target as any).http?.rateLimit?.retryAfterMs ??
      (target as any).http?.retryAfterMs
    const durationMs = typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : 5 * 60_000
    return { bench: true, durationMs }
  }

  if (tag === "QuotaExceeded") {
    return { bench: true, durationMs: 15 * 60_000 }
  }

  if (tag === "Authentication") {
    const kind = (target as any).kind
    if (kind === "invalid" || kind === "expired" || kind === "insufficient-permissions") {
      return { bench: true, durationMs: 15 * 60_000 }
    }
  }

  const message = typeof (target as any).message === "string" ? (target as any).message : ""
  if (/rate[-_\s]?limit|too many requests|429/i.test(message)) {
    return { bench: true, durationMs: 5 * 60_000 }
  }
  if (/quota[-_\s]?exceeded|insufficient[-_\s]?quota|credit balance/i.test(message)) {
    return { bench: true, durationMs: 15 * 60_000 }
  }

  return { bench: false, durationMs: 0 }
}

/**
 * Handles an execution failure for an integration. If the failure is benchable
 * (rate limit, quota exceeded, 429), benches the currently active connection
 * so that subsequent calls to `pick()` advance to another available connection.
 */
export function handleFailure(integrationID: Integration.ID, error: unknown): boolean {
  const check = isBenchableFailure(error)
  if (!check.bench) return false
  return markStickyUnavailable(integrationID, check.durationMs)
}
