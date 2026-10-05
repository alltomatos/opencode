import { describe, expect, test } from "bun:test"
import { hasCronRunBetween, isValidCron, matchesCron } from "./schedule"

describe("Schedule cron parser", () => {
  test("validates valid cron expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true)
    expect(isValidCron("*/5 * * * *")).toBe(true)
    expect(isValidCron("0 0 * * *")).toBe(true)
    expect(isValidCron("15,45 2 * * 1-5")).toBe(true)
    expect(isValidCron("0 12 1 1 *")).toBe(true)
  })

  test("rejects invalid cron expressions", () => {
    expect(isValidCron("")).toBe(false)
    expect(isValidCron("* * * *")).toBe(false)
    expect(isValidCron("* * * * * *")).toBe(false)
    expect(isValidCron("60 * * * *")).toBe(false)
    expect(isValidCron("* 24 * * *")).toBe(false)
    expect(isValidCron("* * 32 * *")).toBe(false)
    expect(isValidCron("* * * 13 *")).toBe(false)
    expect(isValidCron("not-a-cron")).toBe(false)
  })

  test("matchesCron checks date match correctly", () => {
    const now = new Date()
    expect(matchesCron("* * * * *", now)).toBe(true)

    const specific = new Date(2026, 8, 14, 15, 30, 0)
    expect(matchesCron("30 15 * * *", specific)).toBe(true)
    expect(matchesCron("31 15 * * *", specific)).toBe(false)
    expect(matchesCron("30 16 * * *", specific)).toBe(false)

    expect(matchesCron("*/15 * * * *", specific)).toBe(true)
    expect(matchesCron("*/20 * * * *", specific)).toBe(false)
  })

  test("uses OR (not AND) between day-of-month and day-of-week when both are restricted", () => {
    const mondayThe14th = new Date(2026, 8, 14, 0, 0, 0)
    const fridayThe18th = new Date(2026, 8, 18, 0, 0, 0)
    const tuesdayThe1st = new Date(2026, 8, 1, 0, 0, 0)

    expect(matchesCron("0 0 1 * 5", tuesdayThe1st)).toBe(true)
    expect(matchesCron("0 0 1 * 5", fridayThe18th)).toBe(true)
    expect(matchesCron("0 0 1 * 5", mondayThe14th)).toBe(false)

    expect(matchesCron("0 0 * * 5", fridayThe18th)).toBe(true)
    expect(matchesCron("0 0 * * 5", mondayThe14th)).toBe(false)

    expect(matchesCron("0 0 1 * *", tuesdayThe1st)).toBe(true)
    expect(matchesCron("0 0 1 * *", mondayThe14th)).toBe(false)
  })

  test("hasCronRunBetween detects missed schedules", () => {
    // 09:00:00 to 09:45:00
    const start = new Date(2026, 8, 14, 8, 30, 0).getTime()
    const end = new Date(2026, 8, 14, 9, 45, 0).getTime()

    // Ran at 09:00
    expect(hasCronRunBetween("0 9 * * *", start, end)).toBe(true)
    // Runs at 10:00 (outside window)
    expect(hasCronRunBetween("0 10 * * *", start, end)).toBe(false)
    // Runs every 15 minutes
    expect(hasCronRunBetween("*/15 * * * *", start, end)).toBe(true)
  })
})
