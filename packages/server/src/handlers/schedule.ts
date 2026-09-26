import { Schedule } from "@opencode-ai/core/schedule"
import { ScheduleRunner } from "@opencode-ai/core/schedule/runner"
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
            name: ctx.payload.name,
            description: ctx.payload.description,
            trigger: ctx.payload.trigger,
            action: ctx.payload.action,
            workspace: ctx.payload.workspace,
            enabled: ctx.payload.enabled,
          })
          .pipe(Effect.catch((error) => new ScheduleValidationError({ name: "ScheduleValidationError", message: error.message })))
      }),
    )
    .handle(
      "schedule.run",
      Effect.fn(function* (ctx) {
        return yield* ScheduleRunner.runOne(ctx.params.scheduleID).pipe(
          Effect.catchCause((cause) =>
            new ScheduleValidationError({
              name: "ScheduleValidationError",
              message: `Falha ao rodar rotina: ${cause.toString()}`,
            }),
          ),
        )
      }),
    )
    .handle(
      "schedule.test",
      Effect.fn(function* (ctx) {
        return yield* ScheduleRunner.testAction(ctx.payload.action, ctx.payload.workspace).pipe(
          Effect.catchCause((cause) => {
            const pretty = Effect.logError("schedule.test failed", { cause })
            return pretty.pipe(
              Effect.andThen(
                new ScheduleValidationError({
                  name: "ScheduleValidationError",
                  message: `Falha na execução: ${cause.toString()}`,
                }),
              ),
            )
          }),
        )
      }),
    )
      .handle(
        "schedule.update",
        Effect.fn(function* (ctx) {
          const schedules = yield* Schedule.Service
          const updated = yield* schedules
            .update(ctx.params.scheduleID, {
              name: ctx.payload.name,
              description: ctx.payload.description,
              trigger: ctx.payload.trigger,
              action: ctx.payload.action,
              workspace: ctx.payload.workspace,
              enabled: ctx.payload.enabled,
            })
            .pipe(
              Effect.catch((error: any) =>
                new ScheduleValidationError({ name: "ScheduleValidationError", message: error?.message ?? String(error) }),
              ),
            )
          if (!updated) {
            return yield* Effect.fail(
              new ScheduleValidationError({ name: "ScheduleValidationError", message: "Rotina não encontrada" }),
            )
          }
          return updated
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
