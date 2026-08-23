import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Regression guards for two real startup bugs found in 2026-08-23's stability
// pass — both reproduced end-to-end on a real launch before being fixed, and
// both are easy to silently reintroduce since neither has a visible effect
// in the common local dev loop (`bun run dev`) that would catch them again.

describe("package scripts always build before packaging", () => {
  // `bun run dev` never writes out/renderer to disk (electron-vite dev serves
  // it from its own dev server), so running `package:*` standalone after a
  // dev session packaged whatever stale/incomplete out/ was already on disk
  // — missing out/renderer entirely. The packaged app launched a real window
  // that loaded a raw 404 "Not found" instead of the UI. Fixed by making the
  // package scripts build first, matching what CI already did manually.
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf-8")) as {
    scripts: Record<string, string>
  }

  for (const script of ["package", "package:mac", "package:win", "package:linux"]) {
    test(`${script} runs "bun run build" before electron-builder`, () => {
      expect(pkg.scripts[script]).toMatch(/^bun run build\s*&&/)
    })
  }
})

describe("main window disables background throttling", () => {
  // A window created with show:false can start out treated as backgrounded;
  // when the OS never cleanly delivers a "now visible" signal back to
  // Chromium (reproduced reliably with the window opened on a secondary/
  // GPU-attached monitor), throttled rendering suppressed the very first
  // compositor frame indefinitely — the window sat blank/white until an
  // input event forced a repaint. Confirmed via CDP that the DOM was already
  // fully rendered while the on-screen window stayed blank, so this is a
  // presentation-layer bug, not a JS bug — nothing here would show up as a
  // console error or a failing functional test.
  const source = readFileSync(join(import.meta.dirname, "windows.ts"), "utf-8")

  test("webPreferences sets backgroundThrottling: false", () => {
    expect(source).toContain("backgroundThrottling: false")
  })
})

describe("server readiness is gated on the sidecar health check", () => {
  // serverReady used to resolve successfully before the health check even
  // ran, so a sidecar that spawned but never became healthy (port race,
  // blocked loopback, AV interference) was still reported "ready" — the UI
  // was left stuck with no real diagnostic. The health check must now run,
  // and fail, before serverReady resolves.
  const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8")

  // "Deferred.succeed(serverReady" appears twice: once in the SIDECAR_VERSION
  // === "v2" branch (which has no health check to gate on) and once after
  // the health check in the v1 branch this bug lived in — find the health
  // check first, then look for the *next* serverReady resolution after it.
  test("health.wait is awaited before Deferred.succeed(serverReady, ...)", () => {
    const healthWaitIndex = source.indexOf("health.wait")
    const serverReadySucceedIndex = source.indexOf("Deferred.succeed(serverReady", healthWaitIndex)
    expect(healthWaitIndex).toBeGreaterThan(-1)
    expect(serverReadySucceedIndex).toBeGreaterThan(-1)
    expect(healthWaitIndex).toBeLessThan(serverReadySucceedIndex)
  })

  test("a failed/timed-out health check fails the loading task instead of only logging", () => {
    const healthWaitIndex = source.indexOf("health.wait")
    const serverReadySucceedIndex = source.indexOf("Deferred.succeed(serverReady", healthWaitIndex)
    const healthCheckBlock = source.slice(healthWaitIndex, serverReadySucceedIndex)
    expect(healthCheckBlock).toContain("Effect.fail(")
    expect(healthCheckBlock).not.toMatch(/Effect\.catch\(\(e\) =>\s*Effect\.sync/)
  })
})
