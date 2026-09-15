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
    messageDelete: vi.fn(),
  },
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

const { registerMailDeleteMessage } = await import("./delete-message.js");

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
  registerMailDeleteMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_delete_message", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.messageDelete.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("deleta a mensagem com confirm: true (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_delete_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(mockImapClient.messageDelete).toHaveBeenCalledWith("42", { uid: true });
  });

  it("rejeita a chamada quando confirm está ausente (erro de schema, IMAP nunca é chamado)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_delete_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42 },
    });

    expect(result.isError).toBe(true);
    expect(mockImapClient.messageDelete).not.toHaveBeenCalled();
  });

  it("rejeita a chamada quando confirm é false (erro de schema, IMAP nunca é chamado)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_delete_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, confirm: false },
    });

    expect(result.isError).toBe(true);
    expect(mockImapClient.messageDelete).not.toHaveBeenCalled();
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_delete_message",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1, confirm: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(text).toContain("não encontrada");
  });

  it("retorna erro acionável quando o UID não existe", async () => {
    mockImapClient.messageDelete.mockResolvedValue(false);

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_delete_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999, confirm: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
  });
});
