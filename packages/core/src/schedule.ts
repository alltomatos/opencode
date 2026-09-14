export * as Schedule from "./schedule"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Schedule } from "@opencode-ai/schema/schedule"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { ScheduleTable } from "./schedule/sql"

export const ID = Schedule.ID
export type ID = Schedule.ID

export const Trigger = Schedule.Trigger
export type Trigger = Schedule.Trigger

export const Action = Schedule.Action
export type Action = Schedule.Action

export class Info extends Schema.Class<Info>("v2.Schedule.Info")({
  id: ID,
  trigger: Trigger,
  action: Action,
  workspace: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  lastRunAt: Schema.optional(Schema.Number),
  lastStatus: Schema.optional(Schema.Literals(["success", "error"])),
  lastError: Schema.optional(Schema.String),
}) {}

export interface CreateInput {
  readonly trigger: Trigger
  readonly action: Action
  readonly workspace?: string
  readonly enabled?: boolean
}

export interface UpdateInput {
  readonly enabled?: boolean
  readonly lastRunAt?: number
  readonly lastStatus?: "success" | "error"
  readonly lastError?: string
}

export class InvalidCronError extends Schema.TaggedErrorClass<InvalidCronError>()("Schedule.InvalidCronError", {
  message: Schema.String,
}) {}

export class InvalidCommandError extends Schema.TaggedErrorClass<InvalidCommandError>()(
  "Schedule.InvalidCommandError",
  { message: Schema.String },
) {}

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
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
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
  const dayOfWeek = date.getDay()

  if (!matchCronPart(parts[0], minute, 0)) return false
  if (!matchCronPart(parts[1], hour, 0)) return false
  if (!matchCronPart(parts[3], month, 1)) return false

  const domPart = parts[2]
  const dowPart = parts[4]
  const domRestricted = domPart !== "*"
  const dowRestricted = dowPart !== "*"
  const domMatch = matchCronPart(domPart, dayOfMonth, 1)
  const dowMatch = matchCronPart(dowPart, dayOfWeek, 0) || (dayOfWeek === 0 && matchCronPart(dowPart, 7, 0))

  if (domRestricted && dowRestricted) {
    if (!domMatch && !dowMatch) return false
  } else {
    if (domRestricted && !domMatch) return false
    if (dowRestricted && !dowMatch) return false
  }

  return true
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidCronError | InvalidCommandError>
  readonly update: (id: ID, updates: UpdateInput) => Effect.Effect<Info | undefined>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Schedule") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const stored = (row: typeof ScheduleTable.$inferSelect) =>
      new Info({
        id: row.id,
        trigger: row.trigger,
        action: row.action,
        workspace: row.workspace ?? undefined,
        enabled: row.enabled,
        lastRunAt: row.last_run_at ?? undefined,
        lastStatus: row.last_status ?? undefined,
        lastError: row.last_error ?? undefined,
      })

    return Service.of({
      list: Effect.fn("v2.Schedule.list")(function* () {
        return (
          yield* db.select().from(ScheduleTable).orderBy(asc(ScheduleTable.time_created)).all().pipe(Effect.orDie)
        ).map(stored)
      }),
      get: Effect.fn("v2.Schedule.get")(function* (id) {
        const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("v2.Schedule.create")(function* (input) {
        let trigger = input.trigger
        if (trigger.kind === "cron") {
          const expr = trigger.expr.trim()
          if (!isValidCron(expr)) {
            return yield* Effect.fail(
              new InvalidCronError({
                message: `Invalid cron expression: "${trigger.expr}". Expected 5 fields (e.g. '*/5 * * * *')`,
              }),
            )
          }
          trigger = { kind: "cron", expr }
        }

        let action = input.action
        if (action.kind === "shell") {
          const command = action.command.trim()
          if (!command) {
            return yield* Effect.fail(new InvalidCommandError({ message: "Command cannot be empty" }))
          }
          action = { kind: "shell", command }
        }

        const info = new Info({
          id: ID.create(),
          trigger,
          action,
          workspace: input.workspace,
          enabled: input.enabled ?? true,
        })
        yield* db
          .insert(ScheduleTable)
          .values({
            id: info.id,
            trigger: info.trigger,
            action: info.action,
            workspace: info.workspace,
            enabled: info.enabled,
          })
          .run()
          .pipe(Effect.orDie)
        return info
      }),
      update: Effect.fn("v2.Schedule.update")(function* (id, updates) {
        yield* db
          .update(ScheduleTable)
          .set({
            enabled: updates.enabled,
            last_run_at: updates.lastRunAt,
            last_status: updates.lastStatus,
            last_error: updates.lastError,
          })
          .where(eq(ScheduleTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      remove: Effect.fn("v2.Schedule.remove")(function* (id) {
        yield* db.delete(ScheduleTable).where(eq(ScheduleTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
