import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailMarkMessageInputSchema } from "../schemas/tools.schema.js";

export function registerMailMarkMessage(server: McpServer): void {
  server.registerTool(
    "mail_mark_message",
    {
      title: "Marcar mensagem",
      description: "Marca uma mensagem como lida/não lida e/ou com/sem flag de destaque.",
      inputSchema: MailMarkMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountId, folder, uid, seen, flagged }) => {
      if (seen === undefined && flagged === undefined) {
        throw new Error("Informe ao menos um dos campos seen ou flagged.");
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

      await withImapConnection(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          let ok = true;

          if (seen !== undefined) {
            ok =
              (seen
                ? await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
                : await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true })) && ok;
          }

          if (flagged !== undefined) {
            ok =
              (flagged
                ? await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true })
                : await client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true })) && ok;
          }

          if (!ok) {
            throw new Error(
              `Mensagem com UID ${uid} não encontrada na pasta "${folder}" da conta "${accountId}".`
            );
          }
        } finally {
          lock.release();
        }
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ accountId, folder, uid, seen, flagged }, null, 2),
          },
        ],
      };
    }
  );
}
