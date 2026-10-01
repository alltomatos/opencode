import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./reminder.txt"
import { Schedule } from "@opencode-ai/core/schedule"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "list", "cancel", "get"]),
  title: Schema.optional(Schema.String).annotate({
    description: "Título ou assunto principal do lembrete (obrigatório para 'create').",
  }),
  targetDate: Schema.optional(Schema.String).annotate({
    description:
      "Data e hora de disparo em formato ISO-8601 (ex: '2026-10-15T14:00:00Z') ou formato 'YYYY-MM-DD HH:mm'. Obrigatório para 'create'.",
  }),
  remindBefore: Schema.optional(Schema.Literals(["none", "15m", "1h", "2h", "1d", "2d"])).annotate({
    description: "Alerta antecipado opcional antes do horário principal (padrão: 'none').",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "Detalhes adicionais ou instruções da mensagem do lembrete.",
  }),
  channels: Schema.optional(Schema.Array(Schema.Literals(["desktop", "agentui", "telegram", "whatsapp"]))).annotate({
    description: "Canais onde a notificação deve ser entregue (padrão: ['desktop']).",
  }),
  reminderId: Schema.optional(Schema.String).annotate({
    description: "ID do lembrete/rotina (obrigatório para 'cancel' e 'get').",
  }),
})

function parseTargetDate(dateStr: string): number | undefined {
  const parsed = Date.parse(dateStr)
  if (!isNaN(parsed)) return parsed

  // Suporte a formato 'YYYY-MM-DD HH:mm'
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    const [, y, m, d, h, min, s] = match
    const date = new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      parseInt(h, 10),
      parseInt(min, 10),
      s ? parseInt(s, 10) : 0,
    )
    return date.getTime()
  }
  return undefined
}

function getRemindBeforeOffsetMs(before: string | undefined): number {
  if (!before || before === "none") return 0
  if (before === "15m") return 15 * 60 * 1000
  if (before === "1h") return 60 * 60 * 1000
  if (before === "2h") return 2 * 60 * 60 * 1000
  if (before === "1d") return 24 * 60 * 60 * 1000
  if (before === "2d") return 48 * 60 * 60 * 1000
  return 0
}

export const ReminderTool = Tool.define(
  "reminder",
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
            const reminders = list
              .filter((r) => r.action.kind === "reminder")
              .map((r) => {
                const act = r.action as Schedule.ReminderAction
                const targetTs = r.trigger.kind === "once" ? r.trigger.timestamp : undefined
                return {
                  id: r.id,
                  title: act.title,
                  message: act.message,
                  targetDate: targetTs ? new Date(targetTs).toISOString() : undefined,
                  triggerKind: r.trigger.kind,
                  channels: act.channels ?? ["desktop"],
                  enabled: r.enabled,
                  lastStatus: r.lastStatus,
                  lastRunAt: r.lastRunAt ? new Date(r.lastRunAt).toISOString() : undefined,
                }
              })

            return {
              title: "Lembretes Agendados",
              output: JSON.stringify(reminders, null, 2),
              metadata: {},
            }
          }

          if (params.action === "get") {
            if (!params.reminderId) {
              return {
                title: "Erro ao obter lembrete",
                output: "Erro: O parâmetro 'reminderId' é obrigatório para a ação 'get'.",
                metadata: {},
              }
            }
            const found = yield* schedules.get(Schedule.ID.make(params.reminderId))
            if (!found) {
              return {
                title: "Lembrete não encontrado",
                output: `Lembrete com ID '${params.reminderId}' não foi encontrado.`,
                metadata: {},
              }
            }
            return {
              title: `Lembrete: ${found.name ?? found.id}`,
              output: JSON.stringify(found, null, 2),
              metadata: {},
            }
          }

          if (params.action === "cancel") {
            if (!params.reminderId) {
              return {
                title: "Erro ao cancelar lembrete",
                output: "Erro: O parâmetro 'reminderId' é obrigatório para a ação 'cancel'.",
                metadata: {},
              }
            }
            yield* schedules.remove(Schedule.ID.make(params.reminderId))
            return {
              title: "Lembrete Cancelado",
              output: `Lembrete '${params.reminderId}' foi cancelado com sucesso.`,
              metadata: {},
            }
          }

          if (params.action === "create") {
            if (!params.title || !params.targetDate) {
              return {
                title: "Erro ao criar lembrete",
                output: "Erro: 'title' e 'targetDate' são campos obrigatórios para criar um lembrete.",
                metadata: {},
              }
            }

            const targetTimestamp = parseTargetDate(params.targetDate)
            if (!targetTimestamp) {
              return {
                title: "Data Inválida",
                output: `Não foi possível interpretar a data/hora fornecida: "${params.targetDate}". Use o formato ISO-8601 (ex: 2026-10-15T14:00:00Z) ou YYYY-MM-DD HH:mm.`,
                metadata: {},
              }
            }

            const now = Date.now()
            if (targetTimestamp <= now) {
              return {
                title: "Data no Passado",
                output: `A data especificada (${new Date(targetTimestamp).toISOString()}) já passou. Informe uma data futura.`,
                metadata: {},
              }
            }

            const createdReminders = []
            const channels = params.channels ?? ["desktop"]
            const message = params.message ?? params.title

            // 1. Alerta Antecipado (se solicitado)
            const beforeOffsetMs = getRemindBeforeOffsetMs(params.remindBefore)
            if (beforeOffsetMs > 0) {
              const earlyTimestamp = targetTimestamp - beforeOffsetMs
              if (earlyTimestamp > now) {
                const earlySchedule = yield* schedules
                  .create({
                    name: `[Antecipado] ${params.title}`,
                    description: `Aviso antecipado de: ${params.title}`,
                    trigger: { kind: "once", timestamp: earlyTimestamp },
                    action: {
                      kind: "reminder",
                      title: `⚠️ Aviso Antecipado: ${params.title}`,
                      message: `Lembrete em breve (${params.remindBefore}): ${message}`,
                      channels,
                      targetSessionId: ctx.sessionID,
                    },
                    enabled: true,
                  })
                  .pipe(Effect.orDie)
                createdReminders.push({
                  type: "early_alert",
                  id: earlySchedule.id,
                  triggerAt: new Date(earlyTimestamp).toISOString(),
                })
              }
            }

            // 2. Lembrete Principal
            const mainSchedule = yield* schedules
              .create({
                name: params.title,
                description: params.message ?? `Lembrete: ${params.title}`,
                trigger: { kind: "once", timestamp: targetTimestamp },
                action: {
                  kind: "reminder",
                  title: params.title,
                  message,
                  channels,
                  targetSessionId: ctx.sessionID,
                },
                enabled: true,
              })
              .pipe(Effect.orDie)
            createdReminders.push({
              type: "main_reminder",
              id: mainSchedule.id,
              triggerAt: new Date(targetTimestamp).toISOString(),
            })

            return {
              title: "Lembrete Criado",
              output: JSON.stringify(
                {
                  status: "success",
                  message: `Lembrete "${params.title}" agendado com sucesso!`,
                  details: createdReminders,
                },
                null,
                2,
              ),
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
