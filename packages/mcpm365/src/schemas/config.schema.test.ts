import { describe, it, expect } from "vitest";
import { M365ConfigSchema } from "./config.schema.js";

describe("M365 Config Schema", () => {
  it("deve validar configuração client_credentials corretamente", () => {
    const config = {
      auth: {
        type: "client_credentials",
        tenantId: "tenant-123",
        clientId: "client-abc",
        clientSecret: "secret-xyz",
        userPrincipalName: "user@example.com",
      },
    };

    const parsed = M365ConfigSchema.parse(config);
    expect(parsed.auth.type).toBe("client_credentials");
    expect(parsed.auth.clientId).toBe("client-abc");
  });

  it("deve validar configuração device_code com valores padrão", () => {
    const config = {
      auth: {
        type: "device_code",
        clientId: "client-abc",
      },
    };

    const parsed = M365ConfigSchema.parse(config);
    expect(parsed.auth.type).toBe("device_code");
    expect(parsed.auth.tenantId).toBe("common");
    expect(parsed.auth.scopes).toContain("User.Read");
  });
});
