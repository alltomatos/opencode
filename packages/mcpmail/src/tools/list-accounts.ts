import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadAccountsConfig } from "../config.js";
import { MailListAccountsInputSchema } from "../schemas/tools.schema.js";

export function registerMailListAccounts(server: McpServer): void {
  server.registerTool(
    "mail_list_accounts",
    {
      title: "Listar contas de email",
      description:
        "Lista as contas de email configuradas em accounts.json, sem expor credenciais.",
      inputSchema: MailListAccountsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const accounts = loadAccountsConfig();

      const safeAccounts = accounts.map((account) => ({
        id: account.id,
        label: account.label,
        provider: account.provider,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(safeAccounts, null, 2),
          },
        ],
      };
    }
  );
}
