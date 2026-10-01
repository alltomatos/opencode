import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadM365Config } from "../config.js";
import { getGraphClient, getBasePath } from "../services/graph-client.js";
import {
  M365MailSearchSchema,
  M365MailGetMessageSchema,
  M365MailSendMessageSchema,
} from "../schemas/tools.schema.js";

export function registerMailTools(server: McpServer): void {
  server.registerTool(
    "m365_mail_search",
    {
      title: "Buscar emails no Microsoft 365 / Outlook",
      description: "Pesquisa emails na caixa de correio do usuário no Microsoft 365 com filtros opcionais.",
      inputSchema: M365MailSearchSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      let request = client
        .api(`${base}/mailFolders/${params.folder || "inbox"}/messages`)
        .top(params.limit || 10)
        .select("id,subject,from,receivedDateTime,hasAttachments,isRead,bodyPreview");

      if (params.unreadOnly) {
        request = request.filter("isRead eq false");
      }

      if (params.query) {
        request = request.search(`"${params.query}"`);
      }

      const response = await request.get();
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
    "m365_mail_get_message",
    {
      title: "Obter detalhes de email no Microsoft 365",
      description: "Recupera o conteúdo completo de uma mensagem específica por ID.",
      inputSchema: M365MailGetMessageSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ messageId }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const message = await client.api(`${base}/messages/${messageId}`).get();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(message, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "m365_mail_send_message",
    {
      title: "Enviar email via Microsoft 365",
      description: "Envia um novo email através da conta do Microsoft 365.",
      inputSchema: M365MailSendMessageSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, cc, bcc, subject, bodyText, bodyHtml }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const toRecipients = to.map((email) => ({ emailAddress: { address: email } }));
      const ccRecipients = cc?.map((email) => ({ emailAddress: { address: email } })) || [];
      const bccRecipients = bcc?.map((email) => ({ emailAddress: { address: email } })) || [];

      const messagePayload = {
        message: {
          subject,
          body: {
            contentType: bodyHtml ? "HTML" : "Text",
            content: bodyHtml || bodyText || "",
          },
          toRecipients,
          ccRecipients,
          bccRecipients,
        },
        saveToSentItems: true,
      };

      await client.api(`${base}/sendMail`).post(messagePayload);

      return {
        content: [
          {
            type: "text",
            text: `Email "${subject}" enviado com sucesso para ${to.join(", ")}.`,
          },
        ],
      };
    }
  );
}
