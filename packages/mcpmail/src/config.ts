import { readFileSync } from "node:fs";
import {
  AccountsConfigSchema,
  type AccountsConfig,
} from "./schemas/account.schema.js";

const DEFAULT_ACCOUNTS_PATH = "./config/accounts.json";

export function loadAccountsConfig(): AccountsConfig {
  const path = process.env.MAIL_MCP_ACCOUNTS_PATH ?? DEFAULT_ACCOUNTS_PATH;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Não foi possível ler o arquivo de contas em "${path}". Crie-o a partir de config/accounts.example.json ou defina MAIL_MCP_ACCOUNTS_PATH. Causa: ${
        (err as Error).message
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `O arquivo de contas em "${path}" não é um JSON válido. Causa: ${
        (err as Error).message
      }`
    );
  }

  const result = AccountsConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Configuração inválida em "${path}": ${result.error.message}`
    );
  }

  return result.data;
}
