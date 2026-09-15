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
    messageFlagsAdd: vi.fn(),
    messageFlagsRemove: vi.fn(),
  },
}));

vi.mock("../services/imap-client.js", () => ({
  withImapConnection: vi.fn(async (_account: unknown, handler: (client: unknown) => Promise<unknown>) =>
    handler(mockImapClient)
  ),
}));

const { registerMailMarkMessage } = await import("./mark-message.js");

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
  registerMailMarkMessage(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mail_mark_message", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;

    mockImapClient.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() });
    mockImapClient.messageFlagsAdd.mockReset().mockResolvedValue(true);
    mockImapClient.messageFlagsRemove.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("marca como lida (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_mark_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, seen: true },
    });

    expect(result.isError).toBeFalsy();
    expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Seen"], { uid: true });
  });

  it("adiciona flag de destaque (caminho feliz)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_mark_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 42, flagged: true },
    });

    expect(result.isError).toBeFalsy();
    expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Flagged"], { uid: true });
  });

  it("retorna erro acionável quando accountId não existe", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_mark_message",
      arguments: { accountId: "inexistente", folder: "INBOX", uid: 1, seen: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("inexistente");
    expect(text).toContain("não encontrada");
  });

  it("retorna erro acionável quando o UID não existe", async () => {
    mockImapClient.messageFlagsAdd.mockResolvedValue(false);

    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_mark_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 999, seen: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("999");
    expect(text).toContain("não encontrada");
  });

  it("rejeita chamada sem seen nem flagged", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "mail_mark_message",
      arguments: { accountId: "gmail-principal", folder: "INBOX", uid: 1 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("seen");
  });
});
