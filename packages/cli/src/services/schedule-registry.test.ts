import { describe, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { isValidCron, makeWithDirectory, matchesCron } from "./schedule-registry"

describe("ScheduleRegistry", () => {
  describe("cron parser", () => {
    test("validates valid cron expressions", () => {
      expect(isValidCron("* * * * *")).toBe(true)
      expect(isValidCron("*/5 * * * *")).toBe(true)
      expect(isValidCron("0 0 * * *")).toBe(true)
      expect(isValidCron("15,45 2 * * 1-5")).toBe(true)
      expect(isValidCron("0 12 1 1 *")).toBe(true)
    })

    test("rejects invalid cron expressions", () => {
      expect(isValidCron("")).toBe(false)
      expect(isValidCron("* * * *")).toBe(false) // 4 parts
      expect(isValidCron("* * * * * *")).toBe(false) // 6 parts
      expect(isValidCron("60 * * * *")).toBe(false) // minute > 59
      expect(isValidCron("* 24 * * *")).toBe(false) // hour > 23
      expect(isValidCron("* * 32 * *")).toBe(false) // day > 31
      expect(isValidCron("* * * 13 *")).toBe(false) // month > 12
      expect(isValidCron("not-a-cron")).toBe(false)
    })

    test("matchesCron checks date match correctly", () => {
      // Wildcard matches any date
      const now = new Date()
      expect(matchesCron("* * * * *", now)).toBe(true)

      // Exact match
      const specific = new Date(2026, 8, 14, 15, 30, 0) // Sep 14, 2026 15:30 (month index 8 = Sep)
      expect(matchesCron("30 15 * * *", specific)).toBe(true)
      expect(matchesCron("31 15 * * *", specific)).toBe(false)
      expect(matchesCron("30 16 * * *", specific)).toBe(false)

      // Step match
      expect(matchesCron("*/15 * * * *", specific)).toBe(true) // 30 is divisible by 15
      expect(matchesCron("*/20 * * * *", specific)).toBe(false) // 30 is not divisible by 20
    })
  })

  describe("CRUD operations", () => {
    test("adds, lists, gets, updates, and removes scheduled tasks", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-registry-test-"))

      try {
        const program = Effect.gen(function* () {
          const registry = yield* makeWithDirectory(tempDir)

          // Initially empty
          const initial = yield* registry.list()
          expect(initial).toEqual([])

          // Invalid cron fails
          const invalidResult = yield* registry.add({ cron: "invalid", command: "echo hi" }).pipe(Effect.exit)
          expect(invalidResult._tag).toBe("Failure")

          // Empty command fails
          const emptyCmdResult = yield* registry.add({ cron: "* * * * *", command: "" }).pipe(Effect.exit)
          expect(emptyCmdResult._tag).toBe("Failure")

          // Add a valid schedule
          const sch1 = yield* registry.add({
            cron: "*/5 * * * *",
            command: "bun run check",
            workspace: "/home/user/app",
          })
          expect(sch1.id).toMatch(/^sch_/)
          expect(sch1.cron).toBe("*/5 * * * *")
          expect(sch1.command).toBe("bun run check")
          expect(sch1.workspace).toBe("/home/user/app")
          expect(sch1.enabled).toBe(true)

          // Add another schedule
          const sch2 = yield* registry.add({
            cron: "0 0 * * *",
            command: "backup.sh",
          })

          // List both
          const list = yield* registry.list()
          expect(list.length).toBe(2)

          // Get by ID
          const fetched = yield* registry.get(sch1.id)
          expect(fetched?.command).toBe("bun run check")

          // Update status
          const updated = yield* registry.update(sch1.id, {
            lastRunAt: 123456789,
            lastStatus: "success",
          })
          expect(updated?.lastRunAt).toBe(123456789)
          expect(updated?.lastStatus).toBe("success")

          // Persistence check: new instance reads same state
          const registry2 = yield* makeWithDirectory(tempDir)
          const list2 = yield* registry2.list()
          expect(list2.length).toBe(2)
          const persisted = list2.find((item) => item.id === sch1.id)
          expect(persisted?.lastStatus).toBe("success")

          // Remove task
          const removed = yield* registry.rm(sch1.id)
          expect(removed).toBe(true)

          const list3 = yield* registry.list()
          expect(list3.length).toBe(1)
          expect(list3[0].id).toBe(sch2.id)

          // Remove nonexistent
          const removedAgain = yield* registry.rm("nonexistent")
          expect(removedAgain).toBe(false)
        })

        await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)))
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
