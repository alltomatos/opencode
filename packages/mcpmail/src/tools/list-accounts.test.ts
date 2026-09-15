import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerMailListAccounts } from "./list-accounts.js";

const ACCOUNTS_FIXTURE = [
  {
    id: "gmail-principal",
    label: "Gmail Pessoal",
    provider: "gmail",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "usuario@gmail.com",
    appPassword: "segredo-super-secreto",
  },
];

describe("mail_list_accounts", () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.MAIL_MCP_ACCOUNTS_PATH;
    const dir = mkdtempSync(join(tmpdir(), "mail-mcp-test-"));
    const accountsPath = join(dir, "accounts.json");
    writeFileSync(accountsPath, JSON.stringify(ACCOUNTS_FIXTURE));
    process.env.MAIL_MCP_ACCOUNTS_PATH = accountsPath;
  });

  afterEach(() => {
    process.env.MAIL_MCP_ACCOUNTS_PATH = previousPath;
  });

  it("retorna apenas id, label e provider — nunca appPassword/host/user", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerMailListAccounts(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "mail_list_accounts",
      arguments: {},
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const accounts = JSON.parse(text);

    expect(accounts).toEqual([
      { id: "gmail-principal", label: "Gmail Pessoal", provider: "gmail" },
    ]);
    expect(text).not.toContain("segredo-super-secreto");
    expect(text).not.toContain("appPassword");
    expect(text).not.toContain("imap.gmail.com");
  });
});
