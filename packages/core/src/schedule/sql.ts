import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { Schedule } from "../schedule"

export const ScheduleTable = sqliteTable("schedule", {
  id: text().$type<Schedule.ID>().primaryKey(),
  trigger: text({ mode: "json" }).$type<Schedule.Trigger>().notNull(),
  action: text({ mode: "json" }).$type<Schedule.Action>().notNull(),
  workspace: text(),
  enabled: integer({ mode: "boolean" }).notNull(),
  last_run_at: integer(),
  last_status: text().$type<"success" | "error">(),
  last_error: text(),
  ...Timestamps,
})
