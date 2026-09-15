import { describe, expect, it } from "vitest";
import { MailSearchMessagesInputSchema } from "./tools.schema.js";

describe("MailSearchMessagesInputSchema", () => {
  it("aplica defaults quando campos opcionais são omitidos", () => {
    const result = MailSearchMessagesInputSchema.parse({ accountId: "conta-1" });
    expect(result.folder).toBe("INBOX");
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("rejeita limit acima de 100", () => {
    const result = MailSearchMessagesInputSchema.safeParse({
      accountId: "conta-1",
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it("aceita filtros combinados", () => {
    const result = MailSearchMessagesInputSchema.safeParse({
      accountId: "conta-1",
      folder: "INBOX",
      unread: true,
      sender: "alguem@example.com",
      subject: "fatura",
      date: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita campos extras (.strict())", () => {
    const result = MailSearchMessagesInputSchema.safeParse({
      accountId: "conta-1",
      hackField: true,
    });
    expect(result.success).toBe(false);
  });
});
