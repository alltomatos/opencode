import { existsSync, statSync } from "node:fs";
import { createTransport } from "nodemailer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import MailComposer from "nodemailer/lib/mail-composer";
import type { Account } from "../schemas/account.schema.js";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export interface OutgoingAttachment {
  filename: string;
  path?: string;
  contentBase64?: string;
  contentType?: string;
  content?: Buffer;
}

export interface OutgoingMessage {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
}

export function prepareNodemailerAttachments(attachments?: OutgoingAttachment[]) {
  if (!attachments || attachments.length === 0) return undefined;

  return attachments.map((att) => {
    if (att.content) {
      if (att.content.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Anexo "${att.filename}" (${att.content.byteLength} bytes) excede o limite máximo permitido de ${MAX_ATTACHMENT_BYTES} bytes.`
        );
      }
      return {
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      };
    }

    if (att.contentBase64) {
      const buffer = Buffer.from(att.contentBase64, "base64");
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Anexo "${att.filename}" (${buffer.byteLength} bytes) excede o limite máximo permitido de ${MAX_ATTACHMENT_BYTES} bytes.`
        );
      }
      return {
        filename: att.filename,
        content: buffer,
        contentType: att.contentType,
      };
    }

    if (att.path) {
      if (!existsSync(att.path)) {
        throw new Error(`Arquivo do anexo "${att.filename}" não encontrado no caminho: ${att.path}`);
      }
      const stat = statSync(att.path);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Arquivo do anexo "${att.filename}" (${stat.size} bytes) excede o limite máximo permitido de ${MAX_ATTACHMENT_BYTES} bytes.`
        );
      }
      return {
        filename: att.filename,
        path: att.path,
        contentType: att.contentType,
      };
    }

    throw new Error(`Anexo "${att.filename}" inválido: informe "path" ou "contentBase64".`);
  });
}

export interface SendSmtpResult {
  messageId?: string;
  rawRfc822: Buffer;
}

/**
 * Constrói o buffer bruto MIME RFC822 do email usando MailComposer do nodemailer.
 */
export async function buildRawRfc822(
  account: Account,
  message: OutgoingMessage
): Promise<Buffer> {
  const attachments = prepareNodemailerAttachments(message.attachments);
  const composer = new MailComposer({
    from: account.user,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments,
  });

  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err: Error | null, messageBuffer: Buffer) => {
      if (err) return reject(err);
      resolve(messageBuffer);
    });
  });
}

/**
 * Envia um email via SMTP para a conta informada e retorna o buffer RFC822 bruto.
 * Cria um transporter por chamada e não mantém pool persistente — mesma decisão
 * tomada para IMAP em src/services/imap-client.ts (ver ADR 0001/0002).
 */
export async function sendViaSmtp(
  account: Account,
  message: OutgoingMessage
): Promise<SendSmtpResult> {
  if (!account.smtp) {
    throw new Error(
      `Conta "${account.id}" não possui configuração "smtp" em accounts.json. Adicione um bloco { host, port, secure } para habilitar o envio nesta conta.`
    );
  }

  const isSpeedmail = account.provider === "speedmail";
  const transporter = createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.appPassword,
    },
    tls: {
      servername: account.smtp.host,
      rejectUnauthorized: false,
      ...(isSpeedmail ? { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } : {}),
    },
  });

  const attachments = prepareNodemailerAttachments(message.attachments);

  try {
    const info = await transporter.sendMail({
      from: account.user,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      text: message.text,
      html: message.html,
      inReplyTo: message.inReplyTo,
      references: message.references,
      attachments,
    });

    const rawRfc822 = await buildRawRfc822(account, message);

    return {
      messageId: info.messageId,
      rawRfc822,
    };
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
