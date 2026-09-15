import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { mockSendViaSmtp } = vi.hoisted(() => ({
  mockSendViaSmtp: vi.fn(),
}));

vi.mock("../services/smtp-client.js", () => ({
  sendViaSmtp: mockSendViaSmtp,
}));

const { registerMailSendMessage } = await import("./send-message.js");

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
  {
    id: "sem-smtp",
    label: "Conta sem SMTP",
    provider: "generic-imap",
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "usuario@example.com",
    appPassword: "segredo",
  },
];

async function connectedClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMailSendMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_send_message", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockSendViaSmtp.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("envia o email com sucesso (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "gmail-principal",
        to: "destino@example.com",
        subject: "Assunto de teste",
        bodyText: "Corpo em texto plano",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockSendViaSmtp).toHaveBeenCalledTimes(1);
    const [account, message] = mockSendViaSmtp.mock.calls[0];
    expect(account.id).toBe("gmail-principal");
    expect(message).toMatchObject({
      to: "destino@example.com",
      subject: "Assunto de teste",
      text: "Corpo em texto plano",
    });
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "inexistente",
        to: "destino@example.com",
        subject: "Assunto",
        bodyText: "Corpo",
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(text).toContain("não encontrada");
    expect(mockSendViaSmtp).not.toHaveBeenCalled();
  });

  it("retorna erro acionável quando a conta não tem configuração smtp", async () => {
    mockSendViaSmtp.mockRejectedValue(
      new Error('Conta "sem-smtp" não possui configuração "smtp" em accounts.json.')
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "sem-smtp",
        to: "destino@example.com",
        subject: "Assunto",
        bodyText: "Corpo",
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("smtp");
  });

  it("rejeita chamada sem bodyText nem bodyHtml", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_send_message",
      arguments: {
        accountId: "gmail-principal",
        to: "destino@example.com",
        subject: "Assunto",
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("bodyText");
    expect(mockSendViaSmtp).not.toHaveBeenCalled();
  });
});
