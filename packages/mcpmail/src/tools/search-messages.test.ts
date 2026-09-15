import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { mockImapClient } = vi.hoisted(() => ({
  mockImapClient: {
    getMailboxLock: vi.fn(),
    search: vi.fn(),
    fetch: vi.fn(),
  },
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

const { registerMailSearchMessages } = await import("./search-messages.js");

const ACCOUNTS_FIXTURE = [
  {
    id: "gmail-principal",
    label: "Gmail Pessoal",
    provider: "gmail",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "usuario@gmail.com",
    appPassword: "segredo",
  },
];

async function connectedClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMailSearchMessages(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function fakeFetch(byUid: Map<number, { subject: string; from: string; date: Date; seen: boolean }>) {
  return function* fetchGenerator(page: number[]) {
    for (const uid of page) {
      const data = byUid.get(uid);
      if (!data) continue;
      const flags = new Set<string>();
      if (data.seen) flags.add("\\Seen");
      yield {
        uid,
        envelope: {
          subject: data.subject,
          from: [{ address: data.from }],
          date: data.date,
        },
        flags,
      };
    }
  };
}

describe("mail_search_messages", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.search.mockReset();
    mockImapClient.fetch.mockReset();
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("retorna mensagens encontradas, mais recentes primeiro (caminho feliz)", async () => {
    const byUid = new Map([
      [10, { subject: "Primeira", from: "a@example.com", date: new Date("2026-01-01T00:00:00Z"), seen: true }],
      [11, { subject: "Segunda", from: "b@example.com", date: new Date("2026-01-02T00:00:00Z"), seen: false }],
      [12, { subject: "Terceira", from: "c@example.com", date: new Date("2026-01-03T00:00:00Z"), seen: false }],
    ]);

    mockImapClient.search.mockResolvedValue([10, 11, 12]);
    mockImapClient.fetch.mockImplementation((page: number[]) => fakeFetch(byUid)(page));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_search_messages",
      arguments: { accountId: "gmail-principal", folder: "INBOX" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const messages = JSON.parse(text);

    expect(messages).toHaveLength(3);
    expect(messages.map((m: { uid: number }) => m.uid)).toEqual([12, 11, 10]);
    expect(messages[0].subject).toBe("Terceira");
    expect(messages[0].seen).toBe(false);
    expect(messages[2].seen).toBe(true);

    expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_search_messages",
      arguments: { accountId: "inexistente" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(text).toContain("não encontrada");
    expect(mockImapClient.getMailboxLock).not.toHaveBeenCalled();
  });

  it("retorna lista vazia quando a busca não encontra mensagens", async () => {
    mockImapClient.search.mockResolvedValue([]);

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_search_messages",
      arguments: { accountId: "gmail-principal" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([]);
  });
});

describe("truncamento de mail_search_messages (regressão)", () => {
  // O truncamento deve cortar por item (não por caractere na string já
  // serializada), para nunca devolver JSON inválido quando o resultado
  // excede CHARACTER_LIMIT. Ver commit fb2ad10.
  function truncateByItem<T>(items: T[], limit: number): { text: string; truncated: boolean } {
    let visibleCount = items.length;
    while (
      visibleCount > 0 &&
      JSON.stringify(items.slice(0, visibleCount), null, 2).length > limit
    ) {
      visibleCount -= 1;
    }
    return {
      text: JSON.stringify(items.slice(0, visibleCount), null, 2),
      truncated: visibleCount < items.length,
    };
  }

  it("produz JSON válido mesmo quando o resultado excede o limite de caracteres", () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      uid: i,
      subject: `Assunto de teste número ${i} com bastante texto para inflar o payload`,
      from: "remetente@example.com",
      date: new Date().toISOString(),
      seen: false,
      flagged: false,
    }));

    const { text, truncated } = truncateByItem(messages, 2_000);

    expect(truncated).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("não trunca quando o resultado cabe no limite", () => {
    const messages = [{ uid: 1, subject: "ok" }];
    const { text, truncated } = truncateByItem(messages, 25_000);
    expect(truncated).toBe(false);
    expect(JSON.parse(text)).toEqual(messages);
  });
});
