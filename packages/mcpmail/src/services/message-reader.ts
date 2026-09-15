import { simpleParser, type ParsedMail } from "mailparser";
import type { ImapFlow } from "imapflow";

export class MessageNotFoundError extends Error {
  constructor(public readonly uid: number) {
    super(`Mensagem com UID ${uid} não encontrada.`);
    this.name = "MessageNotFoundError";
  }
}

/**
 * Baixa e parseia uma mensagem por UID na pasta já travada (getMailboxLock)
 * do client informado. Compartilhado por tools que precisam ler uma
 * mensagem existente para responder/encaminhar (mail_reply_message,
 * mail_forward_message) — mesma lógica usada em mail_get_message.
 */
export async function downloadAndParseMessage(
  client: ImapFlow,
  uid: number
): Promise<ParsedMail> {
  const raw = await client.download(String(uid), undefined, { uid: true });
  if (!raw) {
    throw new MessageNotFoundError(uid);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of raw.content) {
    chunks.push(chunk as Buffer);
  }
  return simpleParser(Buffer.concat(chunks));
}
