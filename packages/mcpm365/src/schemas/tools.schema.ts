import { z } from "zod";

// Outlook / Mail
export const M365MailSearchSchema = z.object({
  query: z.string().optional().describe("Termo de pesquisa geral (assunto, corpo, remetente)"),
  folder: z.string().optional().default("inbox").describe("Pasta de emails (ex: inbox, sentitems, drafts, archive)"),
  limit: z.number().int().min(1).max(50).default(10).describe("Número máximo de emails a retornar"),
  unreadOnly: z.boolean().optional().describe("Filtrar apenas mensagens não lidas"),
});

export const M365MailGetMessageSchema = z.object({
  messageId: z.string().describe("ID da mensagem no Microsoft Graph"),
});

export const M365MailSendMessageSchema = z.object({
  to: z.array(z.string().email()).describe("Destinatários principais (To)"),
  cc: z.array(z.string().email()).optional().describe("Destinatários em cópia (Cc)"),
  bcc: z.array(z.string().email()).optional().describe("Destinatários em cópia oculta (Bcc)"),
  subject: z.string().describe("Assunto do email"),
  bodyText: z.string().optional().describe("Corpo do email em texto simples"),
  bodyHtml: z.string().optional().describe("Corpo do email em HTML"),
});

// Calendar
export const M365CalendarListEventsSchema = z.object({
  startDate: z.string().describe("Data inicial ISO 8601 (ex: 2026-09-29T00:00:00Z)"),
  endDate: z.string().describe("Data final ISO 8601 (ex: 2026-10-06T23:59:59Z)"),
  limit: z.number().int().min(1).max(50).default(20).describe("Máximo de eventos a retornar"),
});

export const M365CalendarCreateEventSchema = z.object({
  subject: z.string().describe("Título do evento ou reunião"),
  startDateTime: z.string().describe("Data e hora de início (ISO 8601)"),
  endDateTime: z.string().describe("Data e hora de término (ISO 8601)"),
  timeZone: z.string().default("UTC").describe("Fuso horário (ex: America/Sao_Paulo ou UTC)"),
  body: z.string().optional().describe("Descrição/pauta do evento"),
  attendees: z.array(z.string().email()).optional().describe("Lista de emails dos participantes"),
  isOnlineMeeting: z.boolean().optional().default(false).describe("Criar reunião online via Microsoft Teams"),
});

// OneDrive & SharePoint Files
export const M365FilesSearchSchema = z.object({
  query: z.string().describe("Termo de busca para arquivos ou pastas"),
  limit: z.number().int().min(1).max(50).default(20).describe("Limite de itens"),
});

export const M365FilesReadSchema = z.object({
  itemId: z.string().describe("ID do item no OneDrive/SharePoint"),
});

// Teams
export const M365TeamsListChatsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe("Limite de chats"),
});

export const M365TeamsSendMessageSchema = z.object({
  chatId: z.string().describe("ID do chat ou canal do Teams"),
  content: z.string().describe("Conteúdo da mensagem a ser enviada"),
});
