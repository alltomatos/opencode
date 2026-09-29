import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./routine.txt"
import { Schedule } from "@opencode-ai/core/schedule"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "get"]),
  routineId: Schema.optional(Schema.String).annotate({
    description: "The ID of the routine/schedule to get (e.g. sch_...). Required when action is 'get'.",
  }),
})

export const RoutineTool = Tool.define(
  "routine",
  Effect.gen(function* () {
    const schedules = yield* Schedule.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "routine",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          if (params.action === "list") {
            const list = yield* schedules.list()
            const routines = list.map((r) => ({
              id: r.id,
              name: r.name ?? "(Sem nome)",
              description: r.description ?? "",
              trigger: r.trigger,
              actionKind: r.action.kind,
              enabled: r.enabled,
              lastStatus: r.lastStatus,
              lastRunAt: r.lastRunAt ? new Date(r.lastRunAt).toISOString() : undefined,
            }))

            return {
              title: "Lista de Rotinas",
              output: JSON.stringify(routines, null, 2),
              metadata: {},
            }
          }

          if (params.action === "get") {
            if (!params.routineId) {
              return {
                title: "Erro ao obter rotina",
                output: "Erro: O parâmetro 'routineId' é obrigatório para a ação 'get'.",
                metadata: {},
              }
            }
            const found = yield* schedules.get(Schedule.ID.make(params.routineId))
            if (!found) {
              return {
                title: "Rotina não encontrada",
                output: `Rotina com ID '${params.routineId}' não foi encontrada.`,
                metadata: {},
              }
            }
            return {
              title: `Rotina: ${found.name ?? found.id}`,
              output: JSON.stringify(found, null, 2),
              metadata: {},
            }
          }

          return {
            title: "Ação Inválida",
            output: `Ação desconhecida: ${params.action}`,
            metadata: {},
          }
        }),
    }
  }),
)
