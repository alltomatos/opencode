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

const { registerMailReplyMessage } = await import("./reply-message.js");

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

function buildRawEmail(opts: { cc?: string } = {}): string {
  const lines = [
    "From: remetente@example.com",
    "To: usuario@gmail.com, outro@example.com",
    "Subject: Assunto original",
    "Message-ID: <original-123@example.com>",
    "Date: Thu, 01 Jan 2026 00:00:00 +0000",
  ];
  if (opts.cc) {
    lines.push(`Cc: ${opts.cc}`);
  }
  lines.push(
    "Content-Type: text/plain",
    "",
    "Corpo da mensagem original.",
    ""
  );
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
  registerMailReplyMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_reply_message", () => {
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

  it("responde ao remetente original com Re: e headers corretos (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_reply_message",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 42,
        bodyText: "Aqui está minha resposta.",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.to).toBe("remetente@example.com");
    expect(message.subject).toBe("Re: Assunto original");
    expect(message.inReplyTo).toBe("<original-123@example.com>");
    expect(message.references).toContain("<original-123@example.com>");
    expect(message.text).toContain("Aqui está minha resposta.");
    expect(message.text).toContain("> Corpo da mensagem original.");
  });

  it("não duplica 'Re:' quando o assunto original já começa com Re:", async () => {
    mockImapClient.download.mockResolvedValue(
      downloadObjectFor(buildRawEmail().replace("Subject: Assunto original", "Subject: Re: Assunto original"))
    );

    const client = await connectedClient();
    await client.callTool({
      name: "mail_reply_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, bodyText: "Resposta" },
    });

    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.subject).toBe("Re: Assunto original");
  });

  it("não envia references vazio quando a mensagem original não tem Message-ID (regressão)", async () => {
    const rawWithoutMessageId = buildRawEmail()
      .split("\r\n")
      .filter((line) => !line.startsWith("Message-ID:"))
      .join("\r\n");
    mockImapClient.download.mockResolvedValue(downloadObjectFor(rawWithoutMessageId));

    const client = await connectedClient();
    await client.callTool({
      name: "mail_reply_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, bodyText: "Resposta" },
    });

    const [, message] = mockSendViaSmtp.mock.calls[0];
    expect(message.references).toBeUndefined();
    expect(message.inReplyTo).toBeUndefined();
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_reply_message",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1, bodyText: "x" },
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
      name: "mail_reply_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999, bodyText: "x" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
    expect(text).toContain("não encontrada");
  });

  it("rejeita chamada sem bodyText nem bodyHtml", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_reply_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42 },
    });

    expect(result.isError).toBe(true);
    expect(mockSendViaSmtp).not.toHaveBeenCalled();
  });

  it("responde a todos se replyAll for true (ignora o proprio usuario)", async () => {
    mockImapClient.download.mockResolvedValue(
      downloadObjectFor(buildRawEmail({ cc: "copia1@example.com, copia2@example.com" }))
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_reply_message",
      arguments: {
        accountId: "gmail-principal",
        folder: "INBOX",
        uid: 42,
        bodyText: "Resposta para todos.",
        replyAll: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [, message] = mockSendViaSmtp.mock.calls[0];
    
    // remetente + outro (exceto usuario@gmail.com)
    expect(message.to).toContain("remetente@example.com");
    expect(message.to).toContain("outro@example.com");
    expect(message.to).not.toContain("usuario@gmail.com");

    expect(message.cc).toContain("copia1@example.com");
    expect(message.cc).toContain("copia2@example.com");
  });
});
