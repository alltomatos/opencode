import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailDeleteMessageInputSchema } from "../schemas/tools.schema.js";

export function registerMailDeleteMessage(server: McpServer): void {
  server.registerTool(
    "mail_delete_message",
    {
      title: "Deletar mensagem",
      description:
        "Deleta uma mensagem permanentemente. Operação IRREVERSÍVEL — exige confirm: true explícito.",
      inputSchema: MailDeleteMessageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
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

      await withImapConnection(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const result = await client.messageDelete(String(uid), { uid: true });
          if (!result) {
            throw new Error(
              `Não foi possível deletar a mensagem UID ${uid} na pasta "${folder}" da conta "${accountId}". Verifique se o UID existe.`
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
            text: JSON.stringify({ accountId, folder, uid, deleted: true }, null, 2),
          },
        ],
      };
    }
  );
}
