import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockImapClient, mockWithImapConnection } = vi.hoisted(() => ({
  mockImapClient: {
    list: vi.fn(),
    append: vi.fn(),
  },
  mockWithImapConnection: vi.fn(),
}));

vi.mock("./imap-client.js", () => ({
  withImapConnection: mockWithImapConnection,
}));

const { resolveSentFolder, saveToSentFolder } = await import("./sent-folder.js");

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-account",
    label: "Test",
    provider: "gmail" as const,
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "user@gmail.com",
    appPassword: "secret",
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    ...overrides,
  };
}

describe("resolveSentFolder", () => {
  it("retorna sentFolder do account se configurado", async () => {
    const account = makeAccount({ sentFolder: "INBOX/Itens Enviados" });
    const result = await resolveSentFolder(mockImapClient as any, account);
    expect(result).toBe("INBOX/Itens Enviados");
    expect(mockImapClient.list).not.toHaveBeenCalled();
  });

  it("detecta pasta com flag \\Sent", async () => {
    const account = makeAccount();
    mockImapClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
      { path: "Drafts", specialUse: "\\Drafts" },
    ]);

    const result = await resolveSentFolder(mockImapClient as any, account);
    expect(result).toBe("[Gmail]/Sent Mail");
  });

  it("fallback para nomes conhecidos se não tem flag \\Sent", async () => {
    const account = makeAccount();
    mockImapClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "Sent", specialUse: undefined },
      { path: "Trash", specialUse: "\\Trash" },
    ]);

    const result = await resolveSentFolder(mockImapClient as any, account);
    expect(result).toBe("Sent");
  });

  it("fallback case-insensitive", async () => {
    const account = makeAccount();
    mockImapClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: undefined },
      { path: "sent items", specialUse: undefined },
    ]);

    const result = await resolveSentFolder(mockImapClient as any, account);
    expect(result).toBe("sent items");
  });

  it("retorna undefined se nada encontrado", async () => {
    const account = makeAccount();
    mockImapClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "Trash", specialUse: "\\Trash" },
    ]);

    const result = await resolveSentFolder(mockImapClient as any, account);
    expect(result).toBeUndefined();
  });
});

describe("saveToSentFolder", () => {
  const rawRfc822 = Buffer.from("From: user@gmail.com\r\nSubject: Test\r\n\r\nbody");

  beforeEach(() => {
    mockImapClient.list.mockReset();
    mockImapClient.append.mockReset();
    mockWithImapConnection.mockReset();
  });

  it("salva com sucesso na pasta detectada", async () => {
    const account = makeAccount();
    mockWithImapConnection.mockImplementation(
      async (_account: unknown, handler: (client: unknown) => Promise<unknown>) => handler(mockImapClient)
    );
    mockImapClient.list.mockResolvedValue([
      { path: "Sent", specialUse: "\\Sent" },
    ]);
    mockImapClient.append.mockResolvedValue(true);

    const result = await saveToSentFolder(account, rawRfc822);
    expect(result.saved).toBe(true);
    expect(result.sentFolder).toBe("Sent");
    expect(mockImapClient.append).toHaveBeenCalledWith("Sent", rawRfc822, ["\\Seen"], expect.any(Date));
  });

  it("retorna warning quando pasta de enviados não encontrada", async () => {
    const account = makeAccount();
    mockWithImapConnection.mockImplementation(
      async (_account: unknown, handler: (client: unknown) => Promise<unknown>) => handler(mockImapClient)
    );
    mockImapClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
    ]);

    const result = await saveToSentFolder(account, rawRfc822);
    expect(result.saved).toBe(false);
    expect(result.warning).toContain("não encontrada");
    expect(mockImapClient.append).not.toHaveBeenCalled();
  });

  it("retorna warning (não crash) se IMAP falhar", async () => {
    const account = makeAccount();
    mockWithImapConnection.mockRejectedValue(new Error("Connection refused"));

    const result = await saveToSentFolder(account, rawRfc822);
    expect(result.saved).toBe(false);
    expect(result.warning).toContain("Connection refused");
  });

  it("usa sentFolder do account sem fazer list", async () => {
    const freshClient = {
      list: vi.fn(),
      append: vi.fn().mockResolvedValue(true),
    };
    mockWithImapConnection.mockImplementation(
      async (_account: unknown, handler: (client: unknown) => Promise<unknown>) => handler(freshClient)
    );

    const account = makeAccount({ sentFolder: "INBOX/Sent" });
    const result = await saveToSentFolder(account, rawRfc822);
    expect(result.saved).toBe(true);
    expect(result.sentFolder).toBe("INBOX/Sent");
    expect(freshClient.list).not.toHaveBeenCalled();
    expect(freshClient.append).toHaveBeenCalledWith("INBOX/Sent", rawRfc822, ["\\Seen"], expect.any(Date));
  });
});
