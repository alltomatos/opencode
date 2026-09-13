// Mirrors packages/opencode/src/whatsapp/index.ts PROVIDER_FIELDS — kept as a
// small static duplicate on purpose (avoids a round-trip just to render a
// form) rather than a shared package, since these are UI labels, not
// business logic. Keep the two in sync when adding/removing a provider or
// changing a field name (the backend's `config` keys must match exactly).
export type WhatsAppProvider =
  | "waha"
  | "evolution"
  | "zapi"
  | "uazapi"
  | "whapi"
  | "wuzapi"
  | "quepasa"
  | "wppconnect"
  | "izapia"

export interface WhatsAppProviderField {
  key: string
  required: boolean
  label: string
}

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsAppProvider, string> = {
  izapia: "izapia",
  waha: "WAHA (self-hosted, Docker)",
  evolution: "Evolution GO (self-hosted, Docker)",
  zapi: "Z-API (SaaS)",
  uazapi: "uazapi (SaaS)",
  whapi: "Whapi.Cloud (SaaS)",
  wuzapi: "Wuzapi (self-hosted, Docker)",
  quepasa: "QuePasa (self-hosted, Docker)",
  wppconnect: "WPPConnect Server (self-hosted, Docker)",
}

// Painel/dashboard oficial do provider, onde a pessoa consegue criar a conta
// e pegar as credenciais pedidas nos campos abaixo. Só preenchido quando
// existe uma URL confirmada (não um chute) — providers self-hosted não têm
// uma, já que rodam no servidor da própria pessoa.
export const WHATSAPP_PROVIDER_LINKS: Partial<Record<WhatsAppProvider, string>> = {
  izapia: "https://app.izapia.com/login",
}

export const WHATSAPP_PROVIDER_FIELDS: Record<WhatsAppProvider, WhatsAppProviderField[]> = {
  waha: [
    { key: "baseUrl", required: true, label: "URL base (ex.: http://localhost:3000)" },
    { key: "apiKey", required: true, label: "API Key (X-Api-Key)" },
    { key: "session", required: false, label: "Nome da sessão (padrão: default)" },
  ],
  evolution: [
    { key: "baseUrl", required: true, label: "URL base do servidor Evolution GO" },
    { key: "apiKey", required: true, label: "API Key da instância" },
  ],
  zapi: [
    { key: "instanceId", required: true, label: "Instance ID" },
    { key: "token", required: true, label: "Token da instância" },
    { key: "clientToken", required: false, label: "Client-Token (se ativado na conta)" },
  ],
  uazapi: [
    { key: "baseUrl", required: true, label: "URL base (ex.: https://minhaempresa.uazapi.com)" },
    { key: "token", required: true, label: "Token da instância" },
  ],
  whapi: [{ key: "token", required: true, label: "Token do canal (Bearer)" }],
  wuzapi: [
    { key: "baseUrl", required: true, label: "URL base do servidor Wuzapi" },
    { key: "token", required: true, label: "Token do usuário" },
  ],
  quepasa: [
    { key: "baseUrl", required: true, label: "URL base da instância QuePasa" },
    { key: "token", required: true, label: "Token da instância" },
  ],
  wppconnect: [
    { key: "baseUrl", required: true, label: "URL base do servidor WPPConnect" },
    { key: "session", required: true, label: "Nome da sessão" },
    { key: "token", required: true, label: "Token Bearer da sessão" },
  ],
  // No "sid" field here — izapia is multi-session, picked via the "buscar
  // sessões" checkboxes in agentui-form.tsx (WhatsAppChannelBinding.sessionIds),
  // not typed in as config.
  izapia: [{ key: "apiKey", required: true, label: "API key do tenant" }],
}
