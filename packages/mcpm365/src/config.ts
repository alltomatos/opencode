import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { M365ConfigSchema, type M365Config } from "./schemas/config.schema.js";

const DEFAULT_CONFIG_PATHS = [
  resolve(process.cwd(), "m365.json"),
  resolve(process.cwd(), ".m365.json"),
  resolve(homedir(), ".config", "opencode", "m365.json"),
];

export function loadM365Config(): M365Config {
  // 1. Tentar carregar de variáveis de ambiente
  if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
    return {
      auth: {
        type: "client_credentials",
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        tenantId: process.env.AZURE_TENANT_ID,
        userPrincipalName: process.env.AZURE_USER_PRINCIPAL_NAME,
      },
    };
  }

  // 2. Tentar carregar de arquivo de configuração
  for (const configPath of DEFAULT_CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        return M365ConfigSchema.parse(raw);
      } catch (err) {
        throw new Error(`Arquivo de configuração M365 inválido em ${configPath}: ${(err as Error).message}`);
      }
    }
  }

  throw new Error(
    "Nenhuma configuração do Microsoft 365 encontrada. Defina as variáveis de ambiente (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID) ou crie o arquivo m365.json."
  );
}
