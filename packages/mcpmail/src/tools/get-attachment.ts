import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { simpleParser } from "mailparser";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailGetAttachmentInputSchema } from "../schemas/tools.schema.js";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export function registerMailGetAttachment(server: McpServer): void {
  server.registerTool(
    "mail_get_attachment",
    {
      title: "Baixar anexo",
      description: "Baixa um anexo específico de uma mensagem, retornado em base64.",
      inputSchema: MailGetAttachmentInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountId, folder, uid, filename }) => {
      const accounts = loadAccountsConfig();
      const account = accounts.find((a) => a.id === accountId);

      if (!account) {
        throw new Error(
          `Conta "${accountId}" não encontrada em accounts.json. Contas disponíveis: ${accounts
            .map((a) => a.id)
            .join(", ")}.`
        );
      }

      const attachment = await withImapConnection(account, async (client) => {
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

          const found = parsed.attachments.find((att) => att.filename === filename);
          if (!found) {
            const available = parsed.attachments
              .map((att) => att.filename ?? "(sem nome)")
              .join(", ");
            throw new Error(
              `Anexo "${filename}" não encontrado na mensagem UID ${uid}. Anexos disponíveis: ${
                available || "(nenhum)"
              }.`
            );
          }

          if (found.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(
              `Anexo "${filename}" (${found.size} bytes) excede o limite de ${MAX_ATTACHMENT_BYTES} bytes suportado por mail_get_attachment.`
            );
          }

          return {
            filename: found.filename ?? "(sem nome)",
            contentType: found.contentType,
            size: found.size,
            contentBase64: found.content.toString("base64"),
          };
        } finally {
          lock.release();
        }
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(attachment, null, 2),
          },
        ],
      };
    }
  );
}
