import { createTransport } from "nodemailer";
import type { Account } from "../schemas/account.schema.js";

export interface OutgoingMessage {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * Envia um email via SMTP para a conta informada. Cria um transporter por
 * chamada e não mantém pool persistente — mesma decisão de simplicidade
 * tomada para IMAP em src/services/imap-client.ts (ver ADR 0001/0002).
 */
export async function sendViaSmtp(account: Account, message: OutgoingMessage): Promise<void> {
  if (!account.smtp) {
    throw new Error(
      `Conta "${account.id}" não possui configuração "smtp" em accounts.json. Adicione um bloco { host, port, secure } para habilitar o envio nesta conta.`
    );
  }

  const transporter = createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.appPassword,
    },
  });

  try {
    await transporter.sendMail({
      from: account.user,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      text: message.text,
      html: message.html,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });
  } catch (err) {
    throw new Error(
      `Falha ao enviar email pela conta "${account.id}" (${account.smtp.host}:${account.smtp.port}). Verifique host/porta/App Password em accounts.json. Causa: ${
        (err as Error).message
      }`
    );
  } finally {
    transporter.close();
  }
}
