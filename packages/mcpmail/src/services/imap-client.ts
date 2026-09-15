import { ImapFlow } from "imapflow";
import type { Account } from "../schemas/account.schema.js";

/**
 * Abre uma conexão IMAP para a conta informada, executa `handler` e garante
 * o fechamento da conexão ao final — sem pool persistente (v1).
 */
export async function withImapConnection<T>(
  account: Account,
  handler: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.appPassword,
    },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Falha ao conectar na conta "${account.id}" (${account.host}:${account.port}). Verifique host/porta/App Password em accounts.json. Causa: ${
        (err as Error).message
      }`
    );
  }

  try {
    return await handler(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
