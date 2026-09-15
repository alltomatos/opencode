import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailMoveMessageInputSchema } from "../schemas/tools.schema.js";

export function registerMailMoveMessage(server: McpServer): void {
  server.registerTool(
    "mail_move_message",
    {
      title: "Mover mensagem",
      description: "Move uma mensagem de uma pasta para outra na mesma conta.",
      inputSchema: MailMoveMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ accountId, sourceFolder, uid, targetFolder }) => {
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
        const lock = await client.getMailboxLock(sourceFolder);
        try {
          const result = await client.messageMove(String(uid), targetFolder, { uid: true });
          if (!result) {
            throw new Error(
              `Não foi possível mover a mensagem UID ${uid} de "${sourceFolder}" para "${targetFolder}" na conta "${accountId}". Verifique se o UID e as pastas existem.`
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
            text: JSON.stringify({ accountId, uid, sourceFolder, targetFolder, moved: true }, null, 2),
          },
        ],
      };
    }
  );
}
