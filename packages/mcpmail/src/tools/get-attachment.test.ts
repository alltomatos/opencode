import { createHash } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simpleParser } from "mailparser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { mockImapClient } = vi.hoisted(() => ({
  mockImapClient: {
    getMailboxLock: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

const { registerMailGetAttachment } = await import("./get-attachment.js");

const ATTACHMENT_CONTENT = "conteúdo-de-teste-do-anexo-1234567890";

function buildRawEmailWithAttachment(): string {
  const base64Content = Buffer.from(ATTACHMENT_CONTENT, "utf-8").toString("base64");
  return [
    "From: remetente@example.com",
    "To: destinatario@example.com",
    "Subject: Teste com anexo",
    'Content-Type: multipart/mixed; boundary="BOUNDARY"',
    "",
    "--BOUNDARY",
    "Content-Type: text/plain",
    "",
    "Corpo da mensagem.",
    "",
    "--BOUNDARY",
    'Content-Type: text/plain; name="arquivo.txt"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="arquivo.txt"',
    "",
    base64Content,
    "",
    "--BOUNDARY--",
    "",
  ].join("\r\n");
}

describe("mail_get_attachment — round-trip do conteúdo", () => {
  it("o base64 do anexo corresponde byte-a-byte ao conteúdo original", async () => {
    const parsed = await simpleParser(buildRawEmailWithAttachment());
    const found = parsed.attachments.find((att) => att.filename === "arquivo.txt");

    expect(found).toBeDefined();

    const contentBase64 = found!.content.toString("base64");
    const roundTripped = Buffer.from(contentBase64, "base64");

    expect(roundTripped.toString("utf-8")).toBe(ATTACHMENT_CONTENT);
    expect(createHash("sha256").update(roundTripped).digest("hex")).toBe(
      createHash("sha256").update(ATTACHMENT_CONTENT, "utf-8").digest("hex")
    );
  });

  it("retorna undefined para filename inexistente", async () => {
    const parsed = await simpleParser(buildRawEmailWithAttachment());
    const found = parsed.attachments.find((att) => att.filename === "nao-existe.txt");
    expect(found).toBeUndefined();
  });
});

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
  registerMailGetAttachment(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_get_attachment (integração)", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.download.mockReset();
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("baixa o anexo em base64 (caminho feliz)", async () => {
    mockImapClient.download.mockResolvedValue(downloadObjectFor(buildRawEmailWithAttachment()));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_attachment",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 1,
        filename: "arquivo.txt",
      },
    });

    expect(result.isError).toBeFalsy();
    const attachment = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);

    expect(attachment.filename).toBe("arquivo.txt");
    expect(Buffer.from(attachment.contentBase64, "base64").toString("utf-8")).toBe(
      ATTACHMENT_CONTENT
    );
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_attachment",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1, filename: "arquivo.txt" },
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
      name: "mail_get_attachment",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999, filename: "arquivo.txt" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
    expect(text).toContain("não encontrada");
  });

  it("retorna erro acionável quando o filename não existe entre os anexos", async () => {
    mockImapClient.download.mockResolvedValue(downloadObjectFor(buildRawEmailWithAttachment()));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_get_attachment",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 1,
        filename: "nao-existe.txt",
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("nao-existe.txt");
    expect(text).toContain("não encontrado");
  });
});
