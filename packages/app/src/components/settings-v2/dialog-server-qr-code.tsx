import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, createResource, Show } from "solid-js"
import QRCode from "qrcode"
import { useLanguage } from "@/context/language"
import { type ServerConnection, serverName } from "@/context/server"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

// Pairing payload docs/prd/mobile-api-reference.md § 4 — the QR code encodes
// the same Basic-Auth credential the desktop app already uses for this
// server (base64(username:password), matching the ?auth_token= mechanism
// the server already accepts, see server/routes/instance/httpapi/middleware/
// authorization.ts). No new backend endpoint needed: the desktop app already
// holds this credential, it just wasn't exposed as a QR code before.
export type ServerPairingPayload = {
  v: 1
  url: string
  token: string
  label?: string
}

export function buildServerPairingPayload(server: ServerConnection.Http): ServerPairingPayload {
  const credential = `${server.http.username ?? ""}:${server.http.password ?? ""}`
  return {
    v: 1,
    url: server.http.url,
    token: btoa(credential),
    label: server.displayName ?? server.label,
  }
}

export const DialogServerQrCode: Component<{
  server: ServerConnection.Http
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const [dataUrl] = createResource(
    () => JSON.stringify(buildServerPairingPayload(props.server)),
    (payload) => QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: "M" }),
  )

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildServerPairingPayload(props.server)))
      showToast({ variant: "success", icon: "circle-check", title: language.t("dialog.server.qr.copied") })
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.server.qr.title", { name: serverName(props.server) })}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col items-center gap-3 px-4 pt-4 pb-2">
        <p class="settings-v2-server-dialog-label text-center">{language.t("dialog.server.qr.description")}</p>
        <Show when={dataUrl()} fallback={<div class="settings-v2-models-status">{language.t("common.loading")}</div>}>
          <img src={dataUrl()} alt={language.t("dialog.server.qr.title", { name: serverName(props.server) })} width="320" height="320" />
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => void copyPayload()}>
          {language.t("dialog.server.qr.copy")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
