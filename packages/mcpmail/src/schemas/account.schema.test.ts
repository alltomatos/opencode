import { describe, expect, it } from "vitest";
import { AccountSchema, AccountsConfigSchema } from "./account.schema.js";

const validAccount = {
  id: "gmail-principal",
  label: "Gmail Pessoal",
  provider: "gmail",
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  user: "usuario@gmail.com",
  appPassword: "xxxxxxxxxxxxxxxx",
};

describe("AccountSchema", () => {
  it("aceita uma conta válida", () => {
    expect(AccountSchema.safeParse(validAccount).success).toBe(true);
  });

  it("rejeita campos extras (.strict())", () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      extraField: "não deveria existir",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita provider fora do enum", () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      provider: "yahoo",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita quando faltam campos obrigatórios", () => {
    const { appPassword, ...withoutPassword } = validAccount;
    expect(AccountSchema.safeParse(withoutPassword).success).toBe(false);
  });

  it("aceita conta sem bloco smtp (opcional)", () => {
    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.smtp).toBeUndefined();
    }
  });

  it("aceita conta com bloco smtp válido", () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    });
    expect(result.success).toBe(true);
  });

  it("rejeita bloco smtp com campos extras (.strict())", () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      smtp: { host: "smtp.gmail.com", port: 587, secure: false, extra: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejeita bloco smtp incompleto", () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      smtp: { host: "smtp.gmail.com" },
    });
    expect(result.success).toBe(false);
  });
});

describe("AccountsConfigSchema", () => {
  it("aceita um array com ao menos uma conta", () => {
    expect(AccountsConfigSchema.safeParse([validAccount]).success).toBe(true);
  });

  it("rejeita array vazio", () => {
    expect(AccountsConfigSchema.safeParse([]).success).toBe(false);
  });
});
