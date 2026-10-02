import { ImapFlow } from "imapflow";
import type { Account } from "../schemas/account.schema.js";

const MAX_RETRIES = 3;

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = ((err as { code?: string })?.code ?? "").toLowerCase();
  return (
    code.includes("econnreset") ||
    code.includes("etimedout") ||
    code.includes("econnrefused") ||
    code.includes("epipe") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("epipe") ||
    msg.includes("closed") ||
    msg.includes("timeout") ||
    msg.includes("handshake") ||
    msg.includes("network") ||
    msg.includes("aborted")
  );
}

/**
 * Abre uma conexão IMAP para a conta informada com retry exponencial para
 * erros transitórios (ex: ECONNRESET, timeouts), executa `handler` e garante
 * o fechamento da conexão ao final.
 */
export async function withImapConnection<T>(
  account: Account,
  handler: (client: ImapFlow) => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Provedor speedmail possui instabilidade conhecida de handshake com TLS 1.3 no Node.js;
    // para speedmail ou em retries de erros de rede/handshake, forçamos TLS 1.2 estável.
    const forceTls12 = account.provider === "speedmail" || attempt > 1;

    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: {
        user: account.user,
        pass: account.appPassword,
      },
      logger: false,
      clientInfo: { name: "mcpmail", version: "1.0.0" },
      tls: {
        servername: account.host,
        rejectUnauthorized: false,
        ...(forceTls12 ? { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } : {}),
      },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    });

    try {
      await client.connect();
      return await handler(client);
    } catch (err) {
      lastError = err;
      const isTransient = isTransientError(err);
      if (attempt < MAX_RETRIES && isTransient) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      break;
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  throw new Error(
    `Falha ao conectar/executar na conta "${account.id}" (${account.host}:${account.port}). Verifique host/porta/App Password em accounts.json. Causa: ${
      (lastError as Error)?.message || String(lastError)
    }`
  );
}
