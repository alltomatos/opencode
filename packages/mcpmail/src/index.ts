import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAccountsConfig } from "./config.js";
import { registerMailListAccounts } from "./tools/list-accounts.js";
import { registerMailListFolders } from "./tools/list-folders.js";
import { registerMailSearchMessages } from "./tools/search-messages.js";
import { registerMailGetMessage } from "./tools/get-message.js";
import { registerMailGetAttachment } from "./tools/get-attachment.js";
import { registerMailSendMessage } from "./tools/send-message.js";
import { registerMailMarkMessage } from "./tools/mark-message.js";
import { registerMailMoveMessage } from "./tools/move-message.js";
import { registerMailDeleteMessage } from "./tools/delete-message.js";
import { registerMailReplyMessage } from "./tools/reply-message.js";
import { registerMailForwardMessage } from "./tools/forward-message.js";

async function main() {
  // Falha rápido e com mensagem acionável se accounts.json estiver ausente/inválido.
  loadAccountsConfig();

  const server = new McpServer({
    name: "mcpmail",
    version: "0.1.0",
  });

  registerMailListAccounts(server);
  registerMailListFolders(server);
  registerMailSearchMessages(server);
  registerMailGetMessage(server);
  registerMailGetAttachment(server);
  registerMailSendMessage(server);
  registerMailMarkMessage(server);
  registerMailMoveMessage(server);
  registerMailDeleteMessage(server);
  registerMailReplyMessage(server);
  registerMailForwardMessage(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[mcpmail] erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
