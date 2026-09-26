import { Schedule } from "@opencode-ai/schema/schedule"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export class ScheduleValidationError extends Schema.ErrorClass<ScheduleValidationError>("ScheduleValidationError")(
  {
    name: Schema.Literal("ScheduleValidationError"),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const ScheduleGroup = HttpApiGroup.make("server.schedule")
  .add(
    HttpApiEndpoint.get("schedule.list", "/api/schedule", {
      query: LocationQuery,
      success: Schema.Array(Schedule.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.list",
          summary: "List scheduled routines",
          description: "List every scheduled routine registered on the remote host.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("schedule.create", "/api/schedule", {
      query: LocationQuery,
      payload: Schedule.CreateInput,
      success: Schedule.Info,
      error: ScheduleValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.create",
          summary: "Create scheduled routine",
          description: "Register a new scheduled routine (trigger + action) on the remote host.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("schedule.run", "/api/schedule/:scheduleID/run", {
      params: { scheduleID: Schedule.ID },
      query: LocationQuery,
      success: Schedule.Info,
      error: ScheduleValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.run",
          summary: "Run a scheduled routine now",
          description: "Execute a scheduled routine's action immediately, regardless of its trigger.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("schedule.test", "/api/schedule/test", {
      query: LocationQuery,
      payload: Schedule.TestInput,
      success: Schedule.TestResult,
      error: ScheduleValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.test",
          summary: "Test a routine action dry-run",
          description: "Execute a routine's action immediately to validate whether it works before saving.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("schedule.update", "/api/schedule/:scheduleID", {
      params: { scheduleID: Schedule.ID },
      query: LocationQuery,
      payload: Schedule.UpdateInput,
      success: Schedule.Info,
      error: ScheduleValidationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.update",
          summary: "Update scheduled routine",
          description: "Update an existing scheduled routine.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("schedule.remove", "/api/schedule/:scheduleID", {
      params: { scheduleID: Schedule.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.schedule.remove",
          summary: "Remove scheduled routine",
          description: "Remove a scheduled routine from the remote host.",
        }),
      ),
  )
