import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchObject } from "imapflow";
import { loadAccountsConfig } from "../config.js";
import { withImapConnection } from "../services/imap-client.js";
import { MailSearchMessagesInputSchema } from "../schemas/tools.schema.js";

const CHARACTER_LIMIT = 25_000;

function buildSearchQuery(params: {
  unread?: boolean;
  sender?: string;
  subject?: string;
  date?: string;
}): SearchObject {
  const query: SearchObject = {};

  if (params.unread === true) query.seen = false;
  if (params.unread === false) query.seen = true;
  if (params.sender) query.from = params.sender;
  if (params.subject) query.subject = params.subject;
  if (params.date) query.since = new Date(params.date);

  if (Object.keys(query).length === 0) {
    query.all = true;
  }

  return query;
}

export function registerMailSearchMessages(server: McpServer): void {
  server.registerTool(
    "mail_search_messages",
    {
      title: "Buscar mensagens",
      description:
        "Busca mensagens em uma pasta com filtros opcionais (remetente, assunto, data, lida/não lida) e paginação.",
      inputSchema: MailSearchMessagesInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountId, folder, limit, offset, unread, sender, subject, date }) => {
      const accounts = loadAccountsConfig();
      const account = accounts.find((a) => a.id === accountId);

      if (!account) {
        throw new Error(
          `Conta "${accountId}" não encontrada em accounts.json. Contas disponíveis: ${accounts
            .map((a) => a.id)
            .join(", ")}.`
        );
      }

      const messages = await withImapConnection(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const query = buildSearchQuery({ unread, sender, subject, date });
          const uids = await client.search(query, { uid: true });

          if (!uids || uids.length === 0) {
            return [];
          }

          const page = uids.slice().reverse().slice(offset, offset + limit);
          if (page.length === 0) {
            return [];
          }

          const results: Array<{
            uid: number;
            subject: string | undefined;
            from: string | undefined;
            date: string | undefined;
            seen: boolean;
            flagged: boolean;
          }> = [];

          for await (const msg of client.fetch(
            page,
            { uid: true, envelope: true, flags: true },
            { uid: true }
          )) {
            results.push({
              uid: msg.uid,
              subject: msg.envelope?.subject,
              from: msg.envelope?.from?.map((a) => a.address).join(", "),
              date: msg.envelope?.date?.toISOString(),
              seen: msg.flags?.has("\\Seen") ?? false,
              flagged: msg.flags?.has("\\Flagged") ?? false,
            });
          }

          results.sort((a, b) => b.uid - a.uid);
          return results;
        } finally {
          lock.release();
        }
      });

      // Trunca por item (não pela string serializada) para nunca devolver JSON inválido.
      let visibleCount = messages.length;
      while (
        visibleCount > 0 &&
        JSON.stringify(messages.slice(0, visibleCount), null, 2).length > CHARACTER_LIMIT
      ) {
        visibleCount -= 1;
      }

      const truncated = visibleCount < messages.length;
      const text = JSON.stringify(messages.slice(0, visibleCount), null, 2);

      return {
        content: [
          {
            type: "text",
            text: truncated
              ? `${text}\n\n[... ${
                  messages.length - visibleCount
                } mensagem(ns) omitida(s) para respeitar o limite de ${CHARACTER_LIMIT} caracteres — refine os filtros ou reduza "limit" ...]`
              : text,
          },
        ],
      };
    }
  );
}
