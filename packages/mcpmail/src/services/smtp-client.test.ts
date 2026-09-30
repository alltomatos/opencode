import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareNodemailerAttachments,
  buildRawRfc822,
  MAX_ATTACHMENT_BYTES,
} from "./smtp-client.js";

describe("prepareNodemailerAttachments", () => {
  it("retorna undefined se a lista for vazia ou undefined", () => {
    expect(prepareNodemailerAttachments(undefined)).toBeUndefined();
    expect(prepareNodemailerAttachments([])).toBeUndefined();
  });

  it("converte contentBase64 em Buffer", () => {
    const base64 = Buffer.from("conteúdo de teste").toString("base64");
    const result = prepareNodemailerAttachments([
      { filename: "doc.txt", contentBase64: base64, contentType: "text/plain" },
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].filename).toBe("doc.txt");
    expect(result![0].contentType).toBe("text/plain");
    expect((result![0] as any).content.toString("utf-8")).toBe("conteúdo de teste");
  });

  it("aceita anexo com Buffer direto", () => {
    const buf = Buffer.from("dados binarios");
    const result = prepareNodemailerAttachments([
      { filename: "dado.bin", content: buf },
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].filename).toBe("dado.bin");
    expect((result![0] as any).content).toBe(buf);
  });

  it("valida e aceita arquivo existente via path", () => {
    const tempFile = join(tmpdir(), `test-mcpmail-${Date.now()}.txt`);
    writeFileSync(tempFile, "arquivo local teste");

    try {
      const result = prepareNodemailerAttachments([
        { filename: "local.txt", path: tempFile },
      ]);

      expect(result).toHaveLength(1);
      expect(result![0].filename).toBe("local.txt");
      expect((result![0] as any).path).toBe(tempFile);
    } finally {
      unlinkSync(tempFile);
    }
  });

  it("lança erro se o arquivo em path não existir", () => {
    expect(() =>
      prepareNodemailerAttachments([
        { filename: "inexistente.pdf", path: "/caminho/nao/existe.pdf" },
      ])
    ).toThrow('não encontrado no caminho: /caminho/nao/existe.pdf');
  });

  it("lança erro se nem path nem contentBase64 forem fornecidos", () => {
    expect(() =>
      prepareNodemailerAttachments([
        { filename: "invalido.txt" } as any,
      ])
    ).toThrow('informe "path" ou "contentBase64"');
  });

  it("lança erro se o tamanho exceder MAX_ATTACHMENT_BYTES", () => {
    const hugeBuffer = Buffer.alloc(MAX_ATTACHMENT_BYTES + 10);
    expect(() =>
      prepareNodemailerAttachments([
        { filename: "grande.bin", content: hugeBuffer },
      ])
    ).toThrow("excede o limite máximo");
  });
});

describe("buildRawRfc822", () => {
  const account = {
    id: "test",
    label: "Test",
    provider: "generic-imap" as const,
    host: "imap.test.com",
    port: 993,
    secure: true,
    user: "from@test.com",
    appPassword: "pw",
  };

  it("gera payload RFC822 válido com cabeçalhos e corpo", async () => {
    const raw = await buildRawRfc822(account, {
      to: "to@test.com",
      subject: "Assunto Teste",
      text: "Corpo do email",
    });

    expect(raw).toBeInstanceOf(Buffer);
    const text = raw.toString("utf-8");
    expect(text).toContain("From: from@test.com");
    expect(text).toContain("To: to@test.com");
    expect(text).toContain("Subject: Assunto Teste");
    expect(text).toContain("Corpo do email");
  });
});
