import type { ImapFlow } from "imapflow";
import type { Account } from "../schemas/account.schema.js";
import { withImapConnection } from "./imap-client.js";

/**
 * Nomes comuns de pastas de itens enviados, em ordem de prioridade.
 * Usados como fallback quando nenhuma pasta tem a flag especial \Sent.
 */
const SENT_FOLDER_CANDIDATES = [
  "Sent",
  "Sent Items",
  "INBOX/Sent",
  "INBOX.Sent",
  "Itens Enviados",
  "E-mails enviados",
  "[Gmail]/Sent Mail",
  "[Gmail]/E-mails enviados",
];

/**
 * Resolve a pasta de itens enviados para a conta:
 * 1. Se account.sentFolder estiver configurado, usa diretamente.
 * 2. Senão, lista as pastas e procura a que tem flag especial \Sent.
 * 3. Senão, procura por nomes conhecidos (case-insensitive).
 * 4. Se nada for encontrado, retorna undefined.
 */
export async function resolveSentFolder(
  client: ImapFlow,
  account: Account
): Promise<string | undefined> {
  if (account.sentFolder) {
    return account.sentFolder;
  }

  const folders = await client.list();

  // 1. Procura pela flag \Sent
  for (const folder of folders) {
    if (folder.specialUse === "\\Sent") {
      return folder.path;
    }
  }

  // 2. Fallback: nomes conhecidos (case-insensitive)
  const folderPaths = folders.map((f) => f.path);
  const folderPathsLower = folderPaths.map((p) => p.toLowerCase());

  for (const candidate of SENT_FOLDER_CANDIDATES) {
    const idx = folderPathsLower.indexOf(candidate.toLowerCase());
    if (idx !== -1) {
      return folderPaths[idx]; // retorna o path original com case correto
    }
  }

  return undefined;
}

export interface SaveToSentResult {
  saved: boolean;
  sentFolder?: string;
  warning?: string;
}

/**
 * Salva o payload RFC822 na pasta de enviados via IMAP APPEND.
 * Marca como \Seen para não aparecer como não lida.
 *
 * Qualquer falha (conexão, pasta inexistente, APPEND) é capturada
 * e retornada como warning — NUNCA mascara o sucesso do envio SMTP.
 */
export async function saveToSentFolder(
  account: Account,
  rawRfc822: Buffer
): Promise<SaveToSentResult> {
  try {
    return await withImapConnection(account, async (client) => {
      const sentPath = await resolveSentFolder(client, account);

      if (!sentPath) {
        return {
          saved: false,
          warning: `Pasta de enviados não encontrada para a conta "${account.id}". Configure "sentFolder" em accounts.json ou verifique as pastas IMAP.`,
        };
      }

      await client.append(sentPath, rawRfc822, ["\\Seen"], new Date());

      return { saved: true, sentFolder: sentPath };
    });
  } catch (err) {
    return {
      saved: false,
      warning: `Falha ao salvar na pasta de enviados da conta "${account.id}": ${(err as Error).message}`,
    };
  }
}
