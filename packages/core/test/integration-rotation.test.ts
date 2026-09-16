import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { IntegrationConnection } from "@opencode-ai/core/integration/connection"
import { IntegrationRotation } from "@opencode-ai/core/integration/rotation"

// Cooldown state is a module-level (not per-test) Map keyed by credential
// id, so every test below uses its own unique credential ids — reusing a
// literal id like "a" across tests would let one test's markUnavailable
// leak into another's assertions.
const credential = (id: string): IntegrationConnection.Info => ({ type: "credential", id: Credential.ID.make(id), label: id })
const env = (name: string): IntegrationConnection.Info => ({ type: "env", name })

describe("IntegrationRotation", () => {
  test("returns undefined for no connections and the only one for a single connection", () => {
    const id = Integration.ID.make("rotation-test-empty")
    expect(IntegrationRotation.pick(id, [])).toBeUndefined()
    const idOne = Integration.ID.make("rotation-test-one")
    expect(IntegrationRotation.pick(idOne, [credential("one-a")])).toEqual(credential("one-a"))
  })

  test("sticks to the same connection across repeated picks", () => {
    const id = Integration.ID.make("rotation-test-sticky")
    const connections = [credential("sticky-a"), credential("sticky-b"), credential("sticky-c")]
    const first = IntegrationRotation.pick(id, connections)
    for (let i = 0; i < 5; i++) {
      expect(IntegrationRotation.pick(id, connections)).toEqual(first)
    }
  })

  test("advances to the next available connection once the sticky one is benched", () => {
    const id = Integration.ID.make("rotation-test-advance")
    const connections = [credential("advance-a"), credential("advance-b"), credential("advance-c")]
    const first = IntegrationRotation.pick(id, connections)!
    IntegrationRotation.markUnavailable(first, 60_000)
    const next = IntegrationRotation.pick(id, connections)!
    expect(next).not.toEqual(first)
    expect(connections).toContainEqual(next)
  })

  test("falls back to a benched connection when every connection is unavailable", () => {
    const id = Integration.ID.make("rotation-test-all-benched")
    const connections = [credential("benched-a"), credential("benched-b")]
    for (const c of connections) IntegrationRotation.markUnavailable(c, 60_000)
    const picked = IntegrationRotation.pick(id, connections)
    expect(picked).toBeDefined()
    expect(connections).toContainEqual(picked!)
  })

  test("clearUnavailable makes a benched connection eligible again", () => {
    const id = Integration.ID.make("rotation-test-clear")
    const a = credential("clear-a")
    const b = credential("clear-b")
    IntegrationRotation.markUnavailable(a, 60_000)
    const pickedWhileBenched = IntegrationRotation.pick(id, [a, b])
    expect(pickedWhileBenched).toEqual(b)

    IntegrationRotation.clearUnavailable(a)
    // b is still sticky from the previous pick, so it stays selected...
    expect(IntegrationRotation.pick(id, [a, b])).toEqual(b)
    // ...but a is selectable again once b gets benched.
    IntegrationRotation.markUnavailable(b, 60_000)
    expect(IntegrationRotation.pick(id, [a, b])).toEqual(a)
  })

  test("treats env connections as a distinct, always-available fallback", () => {
    const id = Integration.ID.make("rotation-test-env")
    const connections = [credential("env-a"), env("SOME_API_KEY")]
    const first = IntegrationRotation.pick(id, connections)!
    IntegrationRotation.markUnavailable(first, 60_000)
    expect(IntegrationRotation.pick(id, connections)).toEqual(env("SOME_API_KEY"))
  })

  test("keeps per-integration sticky state independent (cooldowns are per-connection, not per-integration)", () => {
    const a = Integration.ID.make("rotation-test-independent-a")
    const b = Integration.ID.make("rotation-test-independent-b")
    const connections = [credential("independent-x"), credential("independent-y")]
    const pickedA = IntegrationRotation.pick(a, connections)
    expect(pickedA).toEqual(connections[0])
    IntegrationRotation.markUnavailable(pickedA!, 60_000)
    // x is the same underlying account either way it's viewed, so it stays
    // benched for integration b too — only the *sticky pointer* is per
    // integration, not the cooldown itself.
    const pickedB = IntegrationRotation.pick(b, connections)
    expect(pickedB).toEqual(connections[1])
  })

  test("markStickyUnavailable benches the current sticky connection and advances pick", () => {
    const id = Integration.ID.make("rotation-test-mark-sticky")
    const connections = [credential("sticky-avail-a"), credential("sticky-avail-b")]
    const first = IntegrationRotation.pick(id, connections)!
    expect(first).toEqual(connections[0])

    const benched = IntegrationRotation.markStickyUnavailable(id, 60_000)
    expect(benched).toBe(true)

    const second = IntegrationRotation.pick(id, connections)!
    expect(second).toEqual(connections[1])
  })

  test("handleFailure benches on 429 / RateLimit / QuotaExceeded and ignores unrelated errors", () => {
    const id = Integration.ID.make("rotation-test-handle-failure")
    const connections = [credential("failure-a"), credential("failure-b"), credential("failure-c")]
    const first = IntegrationRotation.pick(id, connections)!
    expect(first).toEqual(connections[0])

    // Non-benchable error (e.g. 400 Bad Request / syntax error)
    const ignored = IntegrationRotation.handleFailure(id, {
      _tag: "InvalidRequest",
      message: "Bad request",
      http: { response: { status: 400 } },
    })
    expect(ignored).toBe(false)
    expect(IntegrationRotation.pick(id, connections)).toEqual(connections[0])

    // RateLimit error benches active connection and advances
    const rateLimited = IntegrationRotation.handleFailure(id, {
      _tag: "RateLimit",
      message: "Too many requests",
      retryAfterMs: 30_000,
    })
    expect(rateLimited).toBe(true)
    const second = IntegrationRotation.pick(id, connections)!
    expect(second).toEqual(connections[1])

    // QuotaExceeded error benches second connection and advances to third
    const quotaExceeded = IntegrationRotation.handleFailure(id, {
      _tag: "QuotaExceeded",
      message: "Quota exceeded",
    })
    expect(quotaExceeded).toBe(true)
    const third = IntegrationRotation.pick(id, connections)!
    expect(third).toEqual(connections[2])
  })
})
