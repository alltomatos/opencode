import { z } from "zod";

export const AccountSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe("Identificador único e estável da conta (ex: 'gmail-principal')."),
    label: z
      .string()
      .min(1)
      .describe("Nome amigável exibido para o usuário (ex: 'Gmail Pessoal')."),
    provider: z
      .enum(["gmail", "speedmail", "outlook", "generic-imap"])
      .describe("Provedor de email, usado para aplicar particularidades de conexão."),
    host: z
      .string()
      .min(1)
      .describe("Hostname do servidor IMAP (ex: 'imap.gmail.com')."),
    port: z
      .number()
      .int()
      .positive()
      .describe("Porta do servidor IMAP (ex: 993 para IMAP com TLS)."),
    secure: z
      .boolean()
      .describe("Define se a conexão usa TLS/SSL implícito."),
    user: z
      .string()
      .min(1)
      .describe("Usuário/login IMAP, geralmente o endereço de email completo."),
    appPassword: z
      .string()
      .min(1)
      .describe("Senha de aplicativo (App Password) usada para autenticação IMAP."),
    smtp: z
      .object({
        host: z
          .string()
          .min(1)
          .describe("Hostname do servidor SMTP (ex: 'smtp.gmail.com')."),
        port: z
          .number()
          .int()
          .positive()
          .describe("Porta do servidor SMTP (ex: 587 para STARTTLS, 465 para SSL)."),
        secure: z
          .boolean()
          .describe("true para SSL implícito (porta 465), false para STARTTLS (porta 587)."),
      })
      .strict()
      .optional()
      .describe(
        "Configuração SMTP para envio de email; se omitida, tools de envio (mail_send_message, mail_reply_message, mail_forward_message) falham com erro claro para esta conta."
      ),
  })
  .strict();

export type Account = z.infer<typeof AccountSchema>;

export const AccountsConfigSchema = z.array(AccountSchema).min(1);

export type AccountsConfig = z.infer<typeof AccountsConfigSchema>;
