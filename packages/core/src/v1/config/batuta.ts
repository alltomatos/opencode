export * as ConfigBatutaV1 from "./batuta"

import { Schema } from "effect"

export const Worker = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable identifier for this worker within the activity" }),
  label: Schema.String.annotate({
    description: "Name the orchestrator uses to delegate to this worker via the task tool",
  }),
  kind: Schema.optional(Schema.Literals(["internal", "external"])).annotate({
    description:
      "'internal' (default) delegates via an opencode subagent session using `model`. 'external' spawns a third-party agent CLI (e.g. claude, codex) in a PTY inside the worker's worktree using `command`/`args`.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model for this worker, in 'providerID/modelID' form. Required when kind is 'internal' (or omitted).",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "Executable to spawn for an external worker, e.g. 'claude' or 'codex'. Required when kind is 'external'.",
  }),
  args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Extra CLI arguments passed to `command` when spawning an external worker.",
  }),
  idleTimeoutMs: Schema.optional(Schema.Number).annotate({
    description:
      "How long the external worker's PTY must be silent before its output is considered a finished turn. Only used when kind is 'external'.",
  }),
}).annotate({ identifier: "BatutaWorker" })
export type Worker = Schema.Schema.Type<typeof Worker>

export const Activity = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable identifier for this activity" }),
  name: Schema.String.annotate({ description: "Display name for this activity" }),
  goal: Schema.String.annotate({ description: "Initial goal/prompt given to the orchestrator" }),
  orchestratorModel: Schema.String.annotate({
    description: "Model that drives the orchestrator, in 'providerID/modelID' form",
  }),
  workers: Schema.mutable(Schema.Array(Worker)).annotate({
    description: "Workers the orchestrator can delegate to by label",
  }),
  useWorktree: Schema.optional(Schema.Boolean).annotate({
    description:
      "@deprecated worker isolation is now always-on — every worker always runs in its own git worktree, this field is ignored",
  }),
  directory: Schema.optional(Schema.String).annotate({
    description: "Project directory this activity runs against",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description:
      "Git branch the main checkout should be on when the activity starts. If it doesn't exist yet, it's created from the current HEAD.",
  }),
  phase: Schema.optional(Schema.Literals(["architecting", "ready", "orchestrating"])).annotate({
    description:
      "Which stage a running activity is in: architect studying, handoff ready for the user to dispatch, or orchestrator dispatching",
  }),
  architectSessionID: Schema.optional(Schema.String).annotate({
    description: "Session ID of the dedicated architect session, set once start() creates it",
  }),
  orchestratorSessionID: Schema.optional(Schema.String).annotate({
    description: "Session ID of the orchestrator session, set once the architect hands off",
  }),
}).annotate({ identifier: "BatutaActivity" })
export type Activity = Schema.Schema.Type<typeof Activity>

export const Info = Schema.Record(Schema.String, Activity).annotate({ identifier: "BatutaConfig" })
export type Info = Schema.Schema.Type<typeof Info>
