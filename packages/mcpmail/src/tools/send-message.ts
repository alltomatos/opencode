import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { sendViaSmtp } from "../services/smtp-client.js";
import { MailSendMessageInputSchema } from "../schemas/tools.schema.js";

export function registerMailSendMessage(server: McpServer): void {
  server.registerTool(
    "mail_send_message",
    {
      title: "Enviar email",
      description: "Envia um novo email via SMTP a partir de uma conta configurada.",
      inputSchema: MailSendMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ accountId, to, cc, bcc, subject, bodyText, bodyHtml }) => {
      if (bodyText === undefined && bodyHtml === undefined) {
        throw new Error("Informe ao menos um dos campos bodyText ou bodyHtml.");
      }

      const accounts = loadAccountsConfig();
      const account = accounts.find((a) => a.id === accountId);

      if (!account) {
        throw new Error(
          `Conta "${accountId}" não encontrada em accounts.json. Contas disponíveis: ${accounts
            .map((a) => a.id)
            .join(", ")}.`
        );
      }

      await sendViaSmtp(account, {
        to,
        cc,
        bcc,
        subject,
        text: bodyText,
        html: bodyHtml,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ sent: true, accountId, to, subject }, null, 2),
          },
        ],
      };
    }
  );
}
