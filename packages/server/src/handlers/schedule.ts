import { Schedule } from "@opencode-ai/core/schedule"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ScheduleValidationError } from "@opencode-ai/protocol/groups/schedule"

export const ScheduleHandler = HttpApiBuilder.group(Api, "server.schedule", (handlers) =>
  handlers
    .handle(
      "schedule.list",
      Effect.fn(function* () {
        return yield* (yield* Schedule.Service).list()
      }),
    )
    .handle(
      "schedule.create",
      Effect.fn(function* (ctx) {
        const schedules = yield* Schedule.Service
        return yield* schedules
          .create({
            trigger: ctx.payload.trigger,
            action: ctx.payload.action,
            workspace: ctx.payload.workspace,
            enabled: ctx.payload.enabled,
          })
          .pipe(Effect.catch((error) => new ScheduleValidationError({ message: error.message })))
      }),
    )
    .handle(
      "schedule.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* Schedule.Service).remove(ctx.params.scheduleID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
