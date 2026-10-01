import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadM365Config } from "../config.js";
import { getGraphClient, getBasePath } from "../services/graph-client.js";
import {
  M365CalendarListEventsSchema,
  M365CalendarCreateEventSchema,
} from "../schemas/tools.schema.js";

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "m365_calendar_list_events",
    {
      title: "Listar eventos do calendário do Microsoft 365",
      description: "Recupera eventos da agenda dentro de uma janela de tempo específica.",
      inputSchema: M365CalendarListEventsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ startDate, endDate, limit }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const response = await client
        .api(`${base}/calendarView`)
        .query({
          startDateTime: startDate,
          endDateTime: endDate,
        })
        .top(limit || 20)
        .select("id,subject,start,end,location,isOnlineMeeting,onlineMeetingUrl,organizer,attendees")
        .orderby("start/dateTime ASC")
        .get();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.value, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "m365_calendar_create_event",
    {
      title: "Criar evento ou reunião no calendário do Microsoft 365",
      description: "Agenda um novo compromisso ou reunião online no calendário.",
      inputSchema: M365CalendarCreateEventSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ subject, startDateTime, endDateTime, timeZone, body, attendees, isOnlineMeeting }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const eventPayload = {
        subject,
        body: body ? { contentType: "HTML", content: body } : undefined,
        start: { dateTime: startDateTime, timeZone: timeZone || "UTC" },
        end: { dateTime: endDateTime, timeZone: timeZone || "UTC" },
        attendees: attendees?.map((email) => ({
          emailAddress: { address: email },
          type: "required",
        })),
        isOnlineMeeting: isOnlineMeeting || false,
        onlineMeetingProvider: isOnlineMeeting ? "teamsForBusiness" : undefined,
      };

      const created = await client.api(`${base}/events`).post(eventPayload);

      return {
        content: [
          {
            type: "text",
            text: `Evento "${subject}" criado com sucesso! ID: ${created.id}${
              created.onlineMeetingUrl ? ` | Link Teams: ${created.onlineMeetingUrl}` : ""
            }`,
          },
        ],
      };
    }
  );
}
