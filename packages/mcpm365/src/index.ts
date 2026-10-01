import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadM365Config } from "./config.js";
import { registerMailTools } from "./tools/mail.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerFilesTools } from "./tools/files.js";
import { registerTeamsTools } from "./tools/teams.js";

async function main() {
  // Valida a presença da configuração no startup
  try {
    loadM365Config();
  } catch (err) {
    console.error(`[mcpm365] Aviso de inicialização: ${(err as Error).message}`);
  }

  const server = new McpServer({
    name: "mcpm365",
    version: "0.1.0",
  });

  registerMailTools(server);
  registerCalendarTools(server);
  registerFilesTools(server);
  registerTeamsTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[mcpm365] Erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
