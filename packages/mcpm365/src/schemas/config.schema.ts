import { z } from "zod";

export const M365AuthConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client_credentials"),
    tenantId: z.string().min(1, "Tenant ID é obrigatório"),
    clientId: z.string().min(1, "Client ID é obrigatório"),
    clientSecret: z.string().min(1, "Client Secret é obrigatório"),
    userPrincipalName: z.string().optional(), // Para operações em nome de usuário específico em app-only
  }),
  z.object({
    type: z.literal("device_code"),
    tenantId: z.string().default("common"),
    clientId: z.string().min(1, "Client ID é obrigatório"),
    scopes: z.array(z.string()).default([
      "User.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Files.ReadWrite.All",
      "Chat.ReadWrite",
      "ChatMessage.Send"
    ]),
  }),
]);

export type M365AuthConfig = z.infer<typeof M365AuthConfigSchema>;

export const M365ConfigSchema = z.object({
  auth: M365AuthConfigSchema,
});

export type M365Config = z.infer<typeof M365ConfigSchema>;
