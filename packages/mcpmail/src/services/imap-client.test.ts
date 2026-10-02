import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../schemas/account.schema.js";

const mockConnect = vi.fn();
const mockLogout = vi.fn();
const mockClose = vi.fn();

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    logout: mockLogout,
    close: mockClose,
  })),
}));

const { withImapConnection } = await import("./imap-client.js");

describe("withImapConnection", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockLogout.mockReset();
    mockClose.mockReset();
  });

  const account: Account = {
    id: "protectit",
    label: "ProtectIT Mail",
    provider: "speedmail",
    host: "mail.speedmail.tec.br",
    port: 993,
    secure: true,
    user: "ronaldodavi@protectit.com.br",
    appPassword: "secret-password",
  };

  it("conecta e executa o handler com sucesso", async () => {
    mockConnect.mockResolvedValueOnce(undefined);
    mockLogout.mockResolvedValueOnce(undefined);

    const result = await withImapConnection(account, async () => "ok");

    expect(result).toBe("ok");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("faz retry em caso de ECONNRESET e recupera se a próxima tentativa tiver sucesso", async () => {
    mockConnect
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce(undefined);
    mockLogout.mockResolvedValue(undefined);

    const result = await withImapConnection(account, async () => "recovered");

    expect(result).toBe("recovered");
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("lança erro após esgotar o número máximo de retries", async () => {
    mockConnect.mockRejectedValue(new Error("read ECONNRESET"));
    mockLogout.mockResolvedValue(undefined);

    await expect(
      withImapConnection(account, async () => "should not happen")
    ).rejects.toThrow('Falha ao conectar/executar na conta "protectit"');

    expect(mockConnect).toHaveBeenCalledTimes(3);
  });
});
