export * as ScheduleRegistry from "./schedule-registry"

import { Global } from "@opencode-ai/core/global"
import { Schedule } from "@opencode-ai/schema/schedule"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import path from "path"

export interface AddInput {
  readonly cron: string
  readonly command: string
  readonly workspace?: string
  readonly enabled?: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<readonly Schedule.Info[], unknown>
  readonly get: (id: string) => Effect.Effect<Schedule.Info | undefined, unknown>
  readonly add: (input: AddInput) => Effect.Effect<Schedule.Info, unknown>
  readonly rm: (id: string) => Effect.Effect<boolean, unknown>
  readonly update: (
    id: string,
    updates: Partial<Pick<Schedule.Info, "enabled" | "lastRunAt" | "lastStatus" | "lastError">>,
  ) => Effect.Effect<Schedule.Info | undefined, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/ScheduleRegistry") {}

function matchCronPart(part: string, value: number, min: number): boolean {
  if (part === "*") return true
  if (part.startsWith("*/")) {
    const step = parseInt(part.slice(2), 10)
    if (isNaN(step) || step <= 0) return false
    return (value - min) % step === 0
  }
  if (part.includes(",")) {
    return part.split(",").some((sub) => matchCronPart(sub.trim(), value, min))
  }
  if (part.includes("-")) {
    const [startStr, endStr] = part.split("-")
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    if (isNaN(start) || isNaN(end)) return false
    return value >= start && value <= end
  }
  const num = parseInt(part, 10)
  return !isNaN(num) && num === value
}

export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const limits: [number, number][] = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day of month
    [1, 12], // month
    [0, 7],  // day of week (0 or 7 = Sunday)
  ]
  return parts.every((part, idx) => {
    const [min, max] = limits[idx]
    if (part === "*") return true
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10)
      return !isNaN(step) && step > 0 && step <= max
    }
    if (part.includes(",")) {
      return part.split(",").every((sub) => {
        const n = parseInt(sub.trim(), 10)
        return !isNaN(n) && n >= min && n <= max
      })
    }
    if (part.includes("-")) {
      const [s, e] = part.split("-")
      const start = parseInt(s, 10)
      const end = parseInt(e, 10)
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end
    }
    const n = parseInt(part, 10)
    return !isNaN(n) && n >= min && n <= max
  })
}

export function matchesCron(cron: string, date: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dayOfMonth = date.getDate()
  const month = date.getMonth() + 1
  const dayOfWeek = date.getDay() // 0 = Sunday

  if (!matchCronPart(parts[0], minute, 0)) return false
  if (!matchCronPart(parts[1], hour, 0)) return false
  if (!matchCronPart(parts[2], dayOfMonth, 1)) return false
  if (!matchCronPart(parts[3], month, 1)) return false

  // For day of week, both 0 and 7 are Sunday
  const dowPart = parts[4]
  const dowMatch = matchCronPart(dowPart, dayOfWeek, 0) || (dayOfWeek === 0 && matchCronPart(dowPart, 7, 0))
  if (!dowMatch) return false

  return true
}

const SchedulesListSchema = Schema.Array(Schedule.Info)
const decodeSchedules = Schema.decodeUnknownEffect(Schema.fromJsonString(SchedulesListSchema))
const encodeSchedules = Schema.encodeEffect(Schema.fromJsonString(SchedulesListSchema))

export const makeWithDirectory = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = path.join(directory, "schedules.json")

    const read = Effect.fnUntraced(function* () {
      const content = yield* fs.readFileString(file).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!content || content.trim() === "") return []
      return yield* decodeSchedules(content).pipe(
        Effect.catch(() => Effect.succeed([] as readonly Schedule.Info[])),
      )
    })

    const write = (list: readonly Schedule.Info[]) =>
      Effect.gen(function* () {
        const json = yield* encodeSchedules(list)
        const temp = file + ".tmp"
        yield* fs.makeDirectory(directory, { recursive: true })
        yield* fs.writeFileString(temp, json, { mode: 0o600 })
        yield* fs.rename(temp, file)
      })

    const list = Effect.fn("cli.schedule.list")(function* () {
      return yield* read()
    })

    const get = Effect.fn("cli.schedule.get")(function* (id: string) {
      const all = yield* read()
      return all.find((item) => item.id === id)
    })

    const add = Effect.fn("cli.schedule.add")(function* (input: AddInput) {
      const cron = input.cron.trim()
      if (!isValidCron(cron)) {
        return yield* Effect.fail(new Error(`Invalid cron expression: "${input.cron}". Expected 5 fields (e.g. '*/5 * * * *')`))
      }
      const command = input.command.trim()
      if (!command) {
        return yield* Effect.fail(new Error("Command cannot be empty"))
      }

      const all = yield* read()
      const newSchedule: Schedule.Info = {
        id: Schedule.ID.create(),
        cron,
        command,
        workspace: input.workspace,
        enabled: input.enabled ?? true,
      }

      const next = [...all, newSchedule]
      yield* write(next)
      return newSchedule
    })

    const rm = Effect.fn("cli.schedule.rm")(function* (id: string) {
      const all = yield* read()
      const filtered = all.filter((item) => item.id !== id)
      if (filtered.length === all.length) return false
      yield* write(filtered)
      return true
    })

    const update = Effect.fn("cli.schedule.update")(function* (
      id: string,
      updates: Partial<Pick<Schedule.Info, "enabled" | "lastRunAt" | "lastStatus" | "lastError">>,
    ) {
      const all = yield* read()
      let updated: Schedule.Info | undefined
      const next = all.map((item) => {
        if (item.id === id) {
          updated = { ...item, ...updates }
          return updated
        }
        return item
      })
      if (!updated) return undefined
      yield* write(next)
      return updated
    })

    return Service.of({ list, get, add, rm, update })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return yield* makeWithDirectory(Global.Path.config)
  }),
)
