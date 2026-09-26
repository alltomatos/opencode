import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { mockImapClient, mockSendViaSmtp } = vi.hoisted(() => ({
  mockImapClient: {
    getMailboxLock: vi.fn(),
    download: vi.fn(),
  },
  mockSendViaSmtp: vi.fn(),
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

vi.mock("../services/smtp-client.js", () => ({
  sendViaSmtp: mockSendViaSmtp,
}));

const { registerMailForwardMessage } = await import("./forward-message.js");

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
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
  },
];

function buildRawEmail(): string {
  return [
    "From: remetente@example.com",
    "To: usuario@gmail.com",
    "Subject: Assunto original",
    "Date: Thu, 01 Jan 2026 00:00:00 +0000",
    "Content-Type: text/plain",
    "",
    "Corpo da mensagem original.",
    "",
  ].join("\r\n");
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
  registerMailForwardMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_forward_message", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.download.mockReset().mockResolvedValue(downloadObjectFor(buildRawEmail()));
    mockSendViaSmtp.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("encaminha a mensagem citando o conteúdo original (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_forward_message",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 42,
        to: "novo-destino@example.com",
        bodyText: "Olha isso.",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.to).toBe("novo-destino@example.com");
    expect(message.subject).toBe("Fwd: Assunto original");
    expect(message.text).toContain("Olha isso.");
    expect(message.text).toContain("Corpo da mensagem original.");
    expect(message.text).toContain("remetente@example.com");
  });

  it("não duplica 'Fwd:' quando o assunto original já começa com Fwd:", async () => {
    mockImapClient.download.mockResolvedValue(
      downloadObjectFor(buildRawEmail().replace("Subject: Assunto original", "Subject: Fwd: Assunto original"))
    );

    const client = await connectedClient();
    await client.callTool({
      name: "mail_forward_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, to: "x@example.com" },
    });

    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.subject).toBe("Fwd: Assunto original");
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_forward_message",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1, to: "x@example.com" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(mockSendViaSmtp).not.toHaveBeenCalled();
  });

  it("retorna erro acionável quando o UID não existe", async () => {
    mockImapClient.download.mockResolvedValue(false);

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_forward_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999, to: "x@example.com" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
    expect(text).toContain("não encontrada");
  });

  it("encaminha adicionando novos anexos", async () => {
    mockImapClient.download.mockResolvedValue(downloadObjectFor(buildRawEmail()));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_forward_message",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 42,
        to: "encaminhado@example.com",
        attachments: [
          {
            filename: "extra.txt",
            contentBase64: Buffer.from("texto extra").toString("base64"),
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.attachments).toEqual([
      {
        filename: "extra.txt",
        contentBase64: Buffer.from("texto extra").toString("base64"),
      },
    ]);

    const payload = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(payload.attachmentsCount).toBe(1);
    expect(payload.attachments).toEqual(["extra.txt"]);
  });

  it("encaminha incluindo anexos originais quando includeOriginalAttachments=true", async () => {
    const boundary = "==boundary123==";
    const rawWithAtt = [
      "From: remetente@example.com",
      "To: usuario@gmail.com",
      "Subject: Assunto com anexo",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Corpo original.",
      "",
      `--${boundary}`,
      'Content-Type: application/pdf; name="original.pdf"',
      'Content-Disposition: attachment; filename="original.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("dummy-pdf-content").toString("base64"),
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    mockImapClient.download.mockResolvedValue(downloadObjectFor(rawWithAtt));

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_forward_message",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 42,
        to: "encaminhado@example.com",
        includeOriginalAttachments: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe("original.pdf");
    expect(message.attachments[0].content).toBeInstanceOf(Buffer);

    const payload = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(payload.attachmentsCount).toBe(1);
    expect(payload.attachments).toEqual(["original.pdf"]);
  });
});
