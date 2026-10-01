import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadM365Config } from "../config.js";
import { getGraphClient, getBasePath } from "../services/graph-client.js";
import {
  M365FilesSearchSchema,
  M365FilesReadSchema,
} from "../schemas/tools.schema.js";

export function registerFilesTools(server: McpServer): void {
  server.registerTool(
    "m365_files_search",
    {
      title: "Buscar arquivos no OneDrive / SharePoint",
      description: "Pesquisa por arquivos e documentos armazenados no OneDrive ou SharePoint do Microsoft 365.",
      inputSchema: M365FilesSearchSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const response = await client
        .api(`${base}/drive/root/search(q='${encodeURIComponent(query)}')`)
        .top(limit || 20)
        .select("id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder")
        .get();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.value, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "m365_files_get_metadata",
    {
      title: "Obter metadados de arquivo no OneDrive/SharePoint",
      description: "Recupera detalhes e link de acesso direto para um arquivo ou pasta.",
      inputSchema: M365FilesReadSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ itemId }) => {
      const config = loadM365Config();
      const client = await getGraphClient(config);
      const base = getBasePath(config);

      const item = await client.api(`${base}/drive/items/${itemId}`).get();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(item, null, 2),
          },
        ],
      };
    }
  );
}
