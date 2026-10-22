import { ConfigAgentUIV1 } from "@opencode-ai/core/v1/config/agentui"
import type { WaAdapter } from "waconector"
import { waha } from "waconector/waha"
import { evolution } from "waconector/evolution"
import { zapi } from "waconector/zapi"
import { uazapi } from "waconector/uazapi"
import { whapi } from "waconector/whapi"
import { wuzapi } from "waconector/wuzapi"
import { quepasa } from "waconector/quepasa"
import { wppconnect } from "waconector/wppconnect"
import { izapia } from "waconector/izapia"
import { papi } from "./papi"

export const IZAPIA_BASE_URL = "https://api.izapia.com"

export function buildAdapter(channel: ConfigAgentUIV1.WhatsAppChannelBinding, sidOverride?: string): WaAdapter {
  const cfg = channel.config
  switch (channel.provider) {
    case "papi":
      return papi({
        token: cfg.token ?? "",
        instanceId: sidOverride || channel.sessionIds?.[0] || cfg.instanceId || "",
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        panelUrl: cfg.panelUrl,
      })
    case "waha":
      return waha({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey, session: sidOverride ?? cfg.session })
    case "evolution":
      return evolution({ baseUrl: cfg.baseUrl ?? "", apiKey: cfg.apiKey ?? "", instance: sidOverride ?? cfg.instance ?? cfg.instanceName ?? "" })
    case "zapi":
      return zapi({ instanceId: sidOverride ?? cfg.instanceId ?? "", token: cfg.token ?? "", clientToken: cfg.clientToken })
    case "uazapi":
      return uazapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "", adminToken: cfg.adminToken })
    case "whapi":
      return whapi({ token: cfg.token ?? "" })
    case "wuzapi":
      return wuzapi({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? cfg.userToken ?? "" })
    case "quepasa":
      return quepasa({ baseUrl: cfg.baseUrl ?? "", token: cfg.token ?? "" })
    case "wppconnect":
      return wppconnect({ baseUrl: cfg.baseUrl ?? "", session: sidOverride ?? cfg.session ?? "", token: cfg.token ?? cfg.secretKey ?? "" })
    case "izapia":
      return izapia({
        baseUrl: cfg.baseUrl || IZAPIA_BASE_URL,
        apiKey: cfg.apiKey ?? "",
        sid: sidOverride || channel.sessionIds?.[0] || cfg.sid || "",
      })
  }
}
