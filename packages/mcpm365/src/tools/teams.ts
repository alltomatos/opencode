import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadM365Config } from "../config.js";
import { getGraphClient, getBasePath } from "../services/graph-client.js";
import {
  M365TeamsListChatsSchema,
  M365TeamsSendMessageSchema,
} from "../schemas/tools.schema.js";

export function registerTeamsTools(server: McpServer): void {
  server.registerTool(
    "m365_teams_list_chats",
    {
      title: "Listar conversas no Microsoft Teams",
      description: "Recupera os chats recentes do usuário logado no Teams.",
      inputSchema: M365TeamsListChatsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const response = await client
        .api(`${base}/chats`)
        .top(limit || 20)
        .select("id,topic,chatType,createdDateTime,lastUpdatedDateTime")
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
    "m365_teams_send_message",
    {
      title: "Enviar mensagem no Microsoft Teams",
      description: "Envia uma nova mensagem para um chat ou conversa específica no Teams.",
      inputSchema: M365TeamsSendMessageSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ chatId, content }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);

      const messagePayload = {
        body: {
          content,
        },
      };

      const response = await client.api(`/chats/${chatId}/messages`).post(messagePayload);

      return {
        content: [
          {
            type: "text",
            text: `Mensagem enviada com sucesso no chat ${chatId}! ID da mensagem: ${response.id}`,
          },
        ],
      };
    }
  );
}
