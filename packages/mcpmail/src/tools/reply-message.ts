import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { downloadAndParseMessage, MessageNotFoundError } from "../services/message-reader.js";
import { sendViaSmtp } from "../services/smtp-client.js";
import { MailReplyMessageInputSchema } from "../schemas/tools.schema.js";

function quoteOriginal(from: string | undefined, date: string | undefined, body: string): string {
  const header = `Em ${date ?? "data desconhecida"}, ${from ?? "remetente desconhecido"} escreveu:`;
  const quoted = body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${header}\n${quoted}`;
}

export function registerMailReplyMessage(server: McpServer): void {
  server.registerTool(
    "mail_reply_message",
    {
      title: "Responder mensagem",
      description: "Responde a uma mensagem existente, citando o conteúdo original.",
      inputSchema: MailReplyMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ accountId, folder, uid, to, subject, bodyText, bodyHtml }) => {
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

      const original = await withImapConnection(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          try {
            return await downloadAndParseMessage(client, uid);
          } catch (err) {
            if (err instanceof MessageNotFoundError) {
              throw new Error(
                `Mensagem com UID ${uid} não encontrada na pasta "${folder}" da conta "${accountId}".`
              );
            }
            throw err;
          }
        } finally {
          lock.release();
        }
      });

      const replyTo = to ?? original.from?.value?.[0]?.address;
      if (!replyTo) {
        throw new Error(
          `Não foi possível determinar o destinatário da resposta: informe "to" explicitamente ou verifique se a mensagem original tem remetente.`
        );
      }

      const originalSubject = original.subject ?? "";
      const replySubject =
        subject ?? (originalSubject.toLowerCase().startsWith("re:") ? originalSubject : `Re: ${originalSubject}`);

      const quotedText = quoteOriginal(
        original.from?.text,
        original.date?.toISOString(),
        original.text ?? ""
      );

      const finalText = bodyText !== undefined ? `${bodyText}\n\n${quotedText}` : undefined;

      const referencesList = [
        ...(Array.isArray(original.references) ? original.references : original.references ? [original.references] : []),
        original.messageId,
      ].filter((v): v is string => Boolean(v));

      await sendViaSmtp(account, {
        to: replyTo,
        subject: replySubject,
        text: finalText,
        html: bodyHtml,
        inReplyTo: original.messageId,
        references: referencesList.length > 0 ? referencesList.join(" ") : undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ sent: true, accountId, to: replyTo, subject: replySubject }, null, 2),
          },
        ],
      };
    }
  );
}
