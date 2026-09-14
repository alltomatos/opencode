export * as Schedule from "./schedule"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Schedule.ID"),
  statics((schema) => ({ create: () => schema.make("sch_" + ascending()) })),
)
export type ID = typeof ID.Type

export interface CronTrigger extends Schema.Schema.Type<typeof CronTrigger> {}
export const CronTrigger = Schema.Struct({
  kind: Schema.Literal("cron"),
  expr: Schema.String,
}).annotate({ identifier: "Schedule.CronTrigger" })

export interface IntervalTrigger extends Schema.Schema.Type<typeof IntervalTrigger> {}
export const IntervalTrigger = Schema.Struct({
  kind: Schema.Literal("interval"),
  ms: Schema.Number,
}).annotate({ identifier: "Schedule.IntervalTrigger" })

export interface ManualTrigger extends Schema.Schema.Type<typeof ManualTrigger> {}
export const ManualTrigger = Schema.Struct({
  kind: Schema.Literal("manual"),
}).annotate({ identifier: "Schedule.ManualTrigger" })

export const Trigger = Schema.Union([CronTrigger, IntervalTrigger, ManualTrigger])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "Schedule.Trigger" })
export type Trigger = Schema.Schema.Type<typeof Trigger>

export interface ShellAction extends Schema.Schema.Type<typeof ShellAction> {}
export const ShellAction = Schema.Struct({
  kind: Schema.Literal("shell"),
  command: Schema.String,
}).annotate({ identifier: "Schedule.ShellAction" })

export interface McpToolAction extends Schema.Schema.Type<typeof McpToolAction> {}
export const McpToolAction = Schema.Struct({
  kind: Schema.Literal("mcp_tool"),
  server: Schema.String,
  tool: Schema.String,
  args: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Schedule.McpToolAction" })

export interface SkillMcpTool extends Schema.Schema.Type<typeof SkillMcpTool> {}
export const SkillMcpTool = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
}).annotate({ identifier: "Schedule.SkillMcpTool" })

/**
 * Unlike `name`-based skills, a Routine's "skill" is its own inline instruction --
 * not a reference into the global/project skill catalog. It runs as a fresh
 * agent session prompted with `instructions`, scoped only to this Routine.
 * `mcpTools` optionally grants that session access to specific connected MCP
 * tools -- the "where from" a routine's instructions are allowed to draw on.
 */
export interface SkillAction extends Schema.Schema.Type<typeof SkillAction> {}
export const SkillAction = Schema.Struct({
  kind: Schema.Literal("skill"),
  instructions: Schema.String,
  mcpTools: optional(Schema.Array(SkillMcpTool)),
}).annotate({ identifier: "Schedule.SkillAction" })

export const Action = Schema.Union([ShellAction, McpToolAction, SkillAction])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "Schedule.Action" })
export type Action = Schema.Schema.Type<typeof Action>

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  trigger: Trigger,
  action: Action,
  workspace: optional(Schema.String),
  enabled: optional(Schema.Boolean),
  lastRunAt: optional(Schema.Number),
  lastStatus: optional(Schema.Literals(["success", "error"])),
  lastError: optional(Schema.String),
}).annotate({ identifier: "Schedule.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  trigger: Trigger,
  action: Action,
  workspace: optional(Schema.String),
  enabled: optional(Schema.Boolean),
}).annotate({ identifier: "Schedule.CreateInput" })
