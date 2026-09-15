import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailListFoldersInputSchema } from "../schemas/tools.schema.js";

export function registerMailListFolders(server: McpServer): void {
  server.registerTool(
    "mail_list_folders",
    {
      title: "Listar pastas de uma conta",
      description: "Lista as pastas/mailboxes IMAP de uma conta configurada.",
      inputSchema: MailListFoldersInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountId }) => {
      const accounts = loadAccountsConfig();
      const account = accounts.find((a) => a.id === accountId);

      if (!account) {
        throw new Error(
          `Conta "${accountId}" não encontrada em accounts.json. Contas disponíveis: ${accounts
            .map((a) => a.id)
            .join(", ")}.`
        );
      }

      const folders = await withImapConnection(account, async (client) => {
        const list = await client.list({
          statusQuery: { messages: true, unseen: true },
        });
        return list.map((folder) => ({
          path: folder.path,
          name: folder.name,
          delimiter: folder.delimiter,
          messageCount: folder.status?.messages ?? 0,
          unseenCount: folder.status?.unseen ?? 0,
        }));
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(folders, null, 2),
          },
        ],
      };
    }
  );
}
