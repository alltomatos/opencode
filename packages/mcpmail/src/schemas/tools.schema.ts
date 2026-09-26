import { z } from "zod";

export const MailListAccountsInputSchema = z.object({}).strict();

export type MailListAccountsInput = z.infer<typeof MailListAccountsInputSchema>;

export const MailListFoldersInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe(
        "ID da conta configurada (campo 'id' em accounts.json) cujas pastas serão listadas."
      ),
  })
  .strict();

export type MailListFoldersInput = z.infer<typeof MailListFoldersInputSchema>;

export const MailSearchMessagesInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a busca de mensagens será realizada."),
    folder: z
      .string()
      .min(1)
      .default("INBOX")
      .describe("Caminho da pasta/mailbox a ser pesquisada (ex: 'INBOX', 'Sent'). Padrão: 'INBOX'."),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .default(20)
      .describe("Número máximo de mensagens a retornar (paginação). Padrão: 20, máximo: 100."),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe("Quantidade de mensagens a pular a partir do início do resultado (paginação)."),
    unread: z
      .boolean()
      .optional()
      .describe("Se true, retorna apenas mensagens não lidas; se false, apenas lidas; se omitido, ambas."),
    sender: z
      .string()
      .min(1)
      .optional()
      .describe("Filtra mensagens pelo remetente (endereço ou parte do nome/email do campo 'From')."),
    subject: z
      .string()
      .min(1)
      .optional()
      .describe("Filtra mensagens cujo assunto contenha este texto."),
    date: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        "Filtra mensagens a partir desta data (formato ISO 8601, ex: '2026-01-01T00:00:00Z'). Mensagens anteriores a esta data são excluídas."
      ),
  })
  .strict();

export type MailSearchMessagesInput = z.infer<typeof MailSearchMessagesInputSchema>;

export const MailGetMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a mensagem está armazenada."),
    folder: z
      .string()
      .min(1)
      .describe("Caminho da pasta/mailbox onde a mensagem se encontra (ex: 'INBOX')."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem a ser lida por completo."),
  })
  .strict();

export type MailGetMessageInput = z.infer<typeof MailGetMessageInputSchema>;

export const MailGetAttachmentInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a mensagem com o anexo está armazenada."),
    folder: z
      .string()
      .min(1)
      .describe("Caminho da pasta/mailbox onde a mensagem se encontra (ex: 'INBOX')."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem que contém o anexo."),
    filename: z
      .string()
      .min(1)
      .describe("Nome do arquivo do anexo (conforme retornado por mail_get_message) a ser baixado."),
  })
  .strict();

export type MailGetAttachmentInput = z.infer<typeof MailGetAttachmentInputSchema>;

export const MailAttachmentInputSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .describe("Nome do arquivo do anexo com extensão (ex: 'relatorio.pdf', 'foto.png')."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Caminho absoluto ou relativo do arquivo no disco local. Deve ser informado se 'contentBase64' for omitido."
      ),
    contentBase64: z
      .string()
      .min(1)
      .optional()
      .describe("Conteúdo do arquivo codificado em base64. Deve ser informado se 'path' for omitido."),
    contentType: z
      .string()
      .min(1)
      .optional()
      .describe("Tipo MIME do anexo (ex: 'application/pdf', 'image/png'). Opcional."),
  })
  .strict();

export type MailAttachmentInput = z.infer<typeof MailAttachmentInputSchema>;

export const MailSendMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada (precisa ter bloco 'smtp' em accounts.json) usada para enviar o email."),
    to: z
      .string()
      .min(1)
      .describe("Endereço(s) de destino, separados por vírgula se houver mais de um."),
    cc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia, separados por vírgula se houver mais de um."),
    bcc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia oculta, separados por vírgula se houver mais de um."),
    subject: z.string().min(1).describe("Assunto do email."),
    bodyText: z
      .string()
      .min(1)
      .optional()
      .describe("Corpo do email em texto plano. Pelo menos um entre bodyText/bodyHtml é obrigatório."),
    bodyHtml: z
      .string()
      .min(1)
      .optional()
      .describe("Corpo do email em HTML. Pelo menos um entre bodyText/bodyHtml é obrigatório."),
    attachments: z
      .array(MailAttachmentInputSchema)
      .optional()
      .describe("Lista de anexos a serem enviados (com path local ou contentBase64)."),
  })
  .strict();

export type MailSendMessageInput = z.infer<typeof MailSendMessageInputSchema>;

export const MailMarkMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a mensagem está armazenada."),
    folder: z
      .string()
      .min(1)
      .describe("Caminho da pasta/mailbox onde a mensagem se encontra (ex: 'INBOX')."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem a ser marcada."),
    seen: z
      .boolean()
      .optional()
      .describe("Se true, marca como lida; se false, marca como não lida. Pelo menos um entre seen/flagged é obrigatório."),
    flagged: z
      .boolean()
      .optional()
      .describe("Se true, adiciona a flag de destaque (\\Flagged); se false, remove. Pelo menos um entre seen/flagged é obrigatório."),
  })
  .strict();

export type MailMarkMessageInput = z.infer<typeof MailMarkMessageInputSchema>;

export const MailMoveMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a mensagem está armazenada."),
    sourceFolder: z
      .string()
      .min(1)
      .describe("Pasta de origem onde a mensagem se encontra atualmente."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem a ser movida."),
    targetFolder: z
      .string()
      .min(1)
      .describe("Pasta de destino para onde a mensagem será movida."),
  })
  .strict();

export type MailMoveMessageInput = z.infer<typeof MailMoveMessageInputSchema>;

export const MailDeleteMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada onde a mensagem está armazenada."),
    folder: z
      .string()
      .min(1)
      .describe("Pasta/mailbox onde a mensagem se encontra."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem a ser deletada."),
    confirm: z
      .boolean()
      .refine((val) => val === true, {
        message: "O campo 'confirm' deve ser true para autorizar a exclusão.",
      })
      .describe(
        "Confirmação explícita e obrigatória: deve ser exatamente `true` para a exclusão (irreversível) ser aceita. Sem este campo, a chamada é rejeitada antes de qualquer ação."
      ),
  })
  .strict();

export type MailDeleteMessageInput = z.infer<typeof MailDeleteMessageInputSchema>;

export const MailReplyMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada (precisa ter bloco 'smtp' em accounts.json) usada para responder."),
    folder: z
      .string()
      .min(1)
      .describe("Pasta/mailbox onde a mensagem original se encontra."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem original a ser respondida."),
    to: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) de destino da resposta; se omitido, responde ao remetente original (ou a todos, se replyAll=true)."),
    cc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia, separados por vírgula se houver mais de um."),
    bcc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia oculta, separados por vírgula se houver mais de um."),
    replyAll: z
      .boolean()
      .optional()
      .describe("Se true, responde a todos os destinatários originais (To e Cc), exceto o próprio usuário."),
    subject: z
      .string()
      .min(1)
      .optional()
      .describe("Assunto da resposta; se omitido, deriva 'Re: <assunto original>' automaticamente."),
    bodyText: z
      .string()
      .min(1)
      .optional()
      .describe("Corpo da resposta em texto plano. Pelo menos um entre bodyText/bodyHtml é obrigatório."),
    bodyHtml: z
      .string()
      .min(1)
      .optional()
      .describe("Corpo da resposta em HTML. Pelo menos um entre bodyText/bodyHtml é obrigatório."),
    attachments: z
      .array(MailAttachmentInputSchema)
      .optional()
      .describe("Lista de anexos a serem enviados (com path local ou contentBase64)."),
  })
  .strict();

export type MailReplyMessageInput = z.infer<typeof MailReplyMessageInputSchema>;

export const MailForwardMessageInputSchema = z
  .object({
    accountId: z
      .string()
      .min(1)
      .describe("ID da conta configurada (precisa ter bloco 'smtp' em accounts.json) usada para encaminhar."),
    folder: z
      .string()
      .min(1)
      .describe("Pasta/mailbox onde a mensagem original se encontra."),
    uid: z
      .number()
      .int()
      .positive()
      .describe("UID (identificador único IMAP) da mensagem original a ser encaminhada."),
    to: z
      .string()
      .min(1)
      .describe("Endereço(s) de destino do encaminhamento, separados por vírgula se houver mais de um."),
    cc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia, separados por vírgula se houver mais de um."),
    bcc: z
      .string()
      .min(1)
      .optional()
      .describe("Endereço(s) em cópia oculta, separados por vírgula se houver mais de um."),
    subject: z
      .string()
      .min(1)
      .optional()
      .describe("Assunto do encaminhamento; se omitido, deriva 'Fwd: <assunto original>' automaticamente."),
    bodyText: z
      .string()
      .min(1)
      .optional()
      .describe("Comentário adicional em texto plano, incluído antes da mensagem original citada."),
    attachments: z
      .array(MailAttachmentInputSchema)
      .optional()
      .describe("Lista de novos anexos a serem adicionados ao encaminhamento."),
    includeOriginalAttachments: z
      .boolean()
      .optional()
      .describe("Se true, inclui automaticamente os anexos da mensagem original no encaminhamento (padrão: false)."),
  })
  .strict();

export type MailForwardMessageInput = z.infer<typeof MailForwardMessageInputSchema>;
