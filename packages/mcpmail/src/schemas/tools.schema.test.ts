import { describe, expect, it } from "vitest";
import {
  MailAttachmentInputSchema,
  MailSearchMessagesInputSchema,
  MailSendMessageInputSchema,
} from "./tools.schema.js";

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

describe("MailAttachmentInputSchema", () => {
  it("valida anexo com contentBase64", () => {
    const result = MailAttachmentInputSchema.safeParse({
      filename: "teste.pdf",
      contentBase64: "YWJj",
      contentType: "application/pdf",
    });
    expect(result.success).toBe(true);
  });

  it("valida anexo com path", () => {
    const result = MailAttachmentInputSchema.safeParse({
      filename: "teste.txt",
      path: "/tmp/teste.txt",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita campos extras em attachments", () => {
    const result = MailAttachmentInputSchema.safeParse({
      filename: "teste.txt",
      path: "/tmp/teste.txt",
      extra: 123,
    });
    expect(result.success).toBe(false);
  });
});

describe("MailSendMessageInputSchema", () => {
  it("aceita envio com lista de anexos", () => {
    const result = MailSendMessageInputSchema.safeParse({
      accountId: "acc1",
      to: "destino@example.com",
      subject: "Teste",
      bodyText: "Corpo",
      attachments: [
        { filename: "doc.pdf", path: "C:/docs/doc.pdf" },
        { filename: "foto.png", contentBase64: "aW1n" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
