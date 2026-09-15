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
    download: vi.fn(),
    fetchOne: vi.fn(),
  },
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

const { registerMailGetMessage } = await import("./get-message.js");

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

function buildRawEmail(options: { withAttachment?: boolean; withHtml?: boolean } = {}): string {
  const lines = [
    "From: remetente@example.com",
    "To: destinatario@example.com",
    "Subject: Teste de mensagem",
    "Date: Thu, 01 Jan 2026 00:00:00 +0000",
  ];

  if (options.withAttachment) {
    const base64Content = Buffer.from("conteúdo do anexo", "utf-8").toString("base64");
    lines.push(
      'Content-Type: multipart/mixed; boundary="BOUNDARY"',
      "",
      "--BOUNDARY",
      options.withHtml ? "Content-Type: text/html" : "Content-Type: text/plain",
      "",
      options.withHtml
        ? '<p>Corpo</p><script>alert(1)</script>'
        : "Corpo da mensagem em texto plano.",
      "",
      "--BOUNDARY",
      'Content-Type: text/plain; name="anexo.txt"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="anexo.txt"',
      "",
      base64Content,
      "",
      "--BOUNDARY--",
      ""
    );
  } else {
    lines.push(
      options.withHtml ? "Content-Type: text/html" : "Content-Type: text/plain",
      "",
      options.withHtml
        ? '<p>Corpo</p><script>alert(1)</script>'
        : "Corpo da mensagem em texto plano.",
      ""
    );
  }

  return lines.join("\r\n");
}

function downloadObjectFor(raw: string) {
  return {
    meta: { expectedSize: raw.length, contentType: "message/rfc822" },
    content: (async function* () {
      yield Buffer.from(raw, "utf-8");
    })(),
  };
}

async function connectedClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMailGetMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_get_message", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.download.mockReset();
    mockImapClient.fetchOne.mockReset().mockResolvedValue({ flags: new Set(["\\Seen"]) });
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("lê a mensagem completa e sanitiza o HTML (caminho feliz)", async () => {
    mockImapClient.download.mockResolvedValue(downloadObjectFor(buildRawEmail({ withHtml: true })));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42 },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const message = JSON.parse(text);

    expect(message.subject).toBe("Teste de mensagem");
    expect(message.from).toContain("remetente@example.com");
    expect(message.seen).toBe(true);
    expect(message.bodyHtml).not.toContain("<script>");
    expect(message.attachments).toEqual([]);

    expect(mockImapClient.download).toHaveBeenCalledWith("42", undefined, { uid: true });
  });

  it("inclui metadados de anexos sem baixar o conteúdo binário", async () => {
    mockImapClient.download.mockResolvedValue(downloadObjectFor(buildRawEmail({ withAttachment: true })));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 7 },
    });

    expect(result.isError).toBeFalsy();
    const message = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe("anexo.txt");
    expect(message.attachments[0]).not.toHaveProperty("content");
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_message",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(text).toContain("não encontrada");
    expect(mockImapClient.download).not.toHaveBeenCalled();
  });

  it("retorna erro acionável quando o UID não existe na pasta", async () => {
    mockImapClient.download.mockResolvedValue(false);

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
    expect(text).toContain("não encontrada");
  });
});
