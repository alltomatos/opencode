import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { downloadAndParseMessage, MessageNotFoundError } from "../services/message-reader.js";
import { sendViaSmtp, type OutgoingAttachment } from "../services/smtp-client.js";
import { MailForwardMessageInputSchema } from "../schemas/tools.schema.js";

function buildForwardedBody(comment: string | undefined, original: {
  from?: string;
  date?: string;
  subject?: string;
  to?: string;
  text?: string;
}): string {
  const header = [
    "---------- Mensagem encaminhada ----------",
    original.from ? `De: ${original.from}` : undefined,
    original.date ? `Data: ${original.date}` : undefined,
    original.subject ? `Assunto: ${original.subject}` : undefined,
    original.to ? `Para: ${original.to}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const body = `${header}\n\n${original.text ?? ""}`;
  return comment !== undefined ? `${comment}\n\n${body}` : body;
}

export function registerMailForwardMessage(server: McpServer): void {
  server.registerTool(
    "mail_forward_message",
    {
      title: "Encaminhar mensagem",
      description: "Encaminha uma mensagem existente para novos destinatários.",
      inputSchema: MailForwardMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      accountId,
      folder,
      uid,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      attachments,
      includeOriginalAttachments,
    }) => {
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

      const originalSubject = original.subject ?? "";
      const forwardSubject =
        subject ?? (originalSubject.toLowerCase().startsWith("fwd:") ? originalSubject : `Fwd: ${originalSubject}`);

      const text = buildForwardedBody(bodyText, {
        from: original.from?.text,
        date: original.date?.toISOString(),
        subject: original.subject,
        to: Array.isArray(original.to) ? original.to.map((t) => t.text).join(", ") : original.to?.text,
        text: original.text,
      });

      const outgoingAttachments: OutgoingAttachment[] = [];

      if (includeOriginalAttachments && original.attachments && original.attachments.length > 0) {
        for (const origAtt of original.attachments) {
          outgoingAttachments.push({
            filename: origAtt.filename ?? "anexo",
            content: origAtt.content,
            contentType: origAtt.contentType,
          });
        }
      }

      if (attachments && attachments.length > 0) {
        outgoingAttachments.push(...attachments);
      }

      await sendViaSmtp(account, {
        to,
        cc,
        bcc,
        subject: forwardSubject,
        text,
        attachments: outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sent: true,
                accountId,
                to,
                subject: forwardSubject,
                attachmentsCount: outgoingAttachments.length,
                attachments: outgoingAttachments.map((a) => a.filename),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
