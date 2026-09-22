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
    async ({ accountId, folder, uid, to, cc, bcc, replyAll, subject, bodyText, bodyHtml }) => {
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

      let replyTo = to;
      let replyCc = cc;

      if (!replyTo) {
        const sender = original.from?.value?.[0]?.address;

        if (replyAll) {
          const selfEmail = account.user.toLowerCase();
          const uniqueTo = new Set<string>();

          if (sender && sender.toLowerCase() !== selfEmail) {
            uniqueTo.add(sender);
          }

          const extractAddresses = (field: any): string[] => {
            if (!field) return [];
            if (Array.isArray(field)) {
              return field.flatMap((f: any) => f.value || []).map((v: any) => v.address).filter(Boolean);
            }
            return (field.value || []).map((v: any) => v.address).filter(Boolean);
          };

          extractAddresses(original.to).forEach(addr => {
            if (addr.toLowerCase() !== selfEmail) uniqueTo.add(addr);
          });

          if (uniqueTo.size > 0) {
            replyTo = Array.from(uniqueTo).join(", ");
          } else if (sender) {
            replyTo = sender; // fallback
          }

          if (!replyCc) {
            const uniqueCc = new Set<string>();
            extractAddresses(original.cc).forEach(addr => {
              if (addr.toLowerCase() !== selfEmail) uniqueCc.add(addr);
            });
            if (uniqueCc.size > 0) {
              replyCc = Array.from(uniqueCc).join(", ");
            }
          }
        } else {
          replyTo = sender;
        }
      }

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
        cc: replyCc,
        bcc,
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
            text: JSON.stringify({ sent: true, accountId, to: replyTo, cc: replyCc, bcc, subject: replySubject, replyAll }, null, 2),
          },
        ],
      };
    }
  );
}
