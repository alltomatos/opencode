import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { simpleParser } from "mailparser";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { sanitizeEmailHtml } from "../services/sanitize.js";
import { MailGetMessageInputSchema } from "../schemas/tools.schema.js";

const CHARACTER_LIMIT = 25_000;

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export function registerMailGetMessage(server: McpServer): void {
  server.registerTool(
    "mail_get_message",
    {
      title: "Ler mensagem completa",
      description: "Lê o conteúdo completo de uma mensagem de email por UID.",
      inputSchema: MailGetMessageInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountId, folder, uid }) => {
      const accounts = loadAccountsConfig();
      const account = accounts.find((a) => a.id === accountId);

      if (!account) {
        throw new Error(
          `Conta "${accountId}" não encontrada em accounts.json. Contas disponíveis: ${accounts
            .map((a) => a.id)
            .join(", ")}.`
        );
      }

      const message = await withImapConnection(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const raw = await client.download(String(uid), undefined, { uid: true });
          if (!raw) {
            throw new Error(
              `Mensagem com UID ${uid} não encontrada na pasta "${folder}" da conta "${accountId}".`
            );
          }

          const chunks: Buffer[] = [];
          for await (const chunk of raw.content) {
            chunks.push(chunk as Buffer);
          }
          const parsed = await simpleParser(Buffer.concat(chunks));

          const fetched = await client.fetchOne(
            String(uid),
            { flags: true },
            { uid: true }
          );

          const bodyHtmlRaw =
            typeof parsed.html === "string" ? parsed.html : undefined;

          const { text: bodyText, truncated: bodyTextTruncated } = truncate(
            parsed.text ?? "",
            CHARACTER_LIMIT
          );
          const { text: bodyHtml, truncated: bodyHtmlTruncated } = truncate(
            bodyHtmlRaw ? sanitizeEmailHtml(bodyHtmlRaw) : "",
            CHARACTER_LIMIT
          );

          return {
            uid,
            subject: parsed.subject,
            from: parsed.from?.text,
            to: Array.isArray(parsed.to)
              ? parsed.to.map((t) => t.text).join(", ")
              : parsed.to?.text,
            date: parsed.date?.toISOString(),
            seen: fetched && fetched.flags ? fetched.flags.has("\\Seen") : false,
            flagged: fetched && fetched.flags ? fetched.flags.has("\\Flagged") : false,
            bodyText: bodyTextTruncated ? `${bodyText}\n[... truncado ...]` : bodyText,
            bodyHtml: bodyHtmlTruncated ? `${bodyHtml}\n[... truncado ...]` : bodyHtml,
            attachments: parsed.attachments.map((att) => ({
              filename: att.filename ?? "(sem nome)",
              contentType: att.contentType,
              size: att.size,
            })),
          };
        } finally {
          lock.release();
        }
      });

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
}
