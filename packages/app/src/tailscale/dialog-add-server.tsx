import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createResource, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { normalizeServerUrl, useServer } from "@/context/server"
import { useCheckServerHealth } from "@/utils/server-health"
import "@/components/settings-v2/settings-v2.css"

const TAILSCALE_LABEL = "tailscale"

export function DialogAddTailscaleServer() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const checkHealth = useCheckServerHealth()

  const [status] = createResource(async () => (await platform.checkTailscale?.()) ?? { available: false, ip: null })
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [store, setStore] = createStore({
    host: "",
    port: "4096",
    name: "",
    username: "opencode",
    password: "",
  })

  createEffect(() => {
    const ip = status()?.ip
    if (ip && !store.host) setStore("host", ip)
  })

  const submit = async () => {
    if (!store.host.trim()) {
      setError(language.t("sshTunnel.add.error.hostRequired"))
      return
    }
    const url = normalizeServerUrl(`http://${store.host.trim()}:${store.port.trim() || "4096"}`)
    if (!url) {
      setError(language.t("sshTunnel.add.error.hostRequired"))
      return
    }
    setBusy(true)
    setError("")
    try {
      const http = { url, username: store.username.trim() || undefined, password: store.password || undefined }
      const ok = await checkHealth(http)
      if (!ok) {
        setError(language.t("tailscale.add.error.unreachable"))
        return
      }
      server.add({
        type: "http",
        http,
        label: TAILSCALE_LABEL,
        displayName: store.name.trim() || undefined,
      })
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("tailscale.add.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <Show when={!status.loading} fallback={<LoaderV2 />}>
          <Show
            when={status()?.available}
            fallback={<div class="settings-v2-server-dialog-error">{language.t("tailscale.add.error.notRunning")}</div>}
          >
            <div class="flex w-full min-w-0 flex-col gap-6">
              <div class="grid w-full min-w-0 grid-cols-3 gap-4">
                <div class="col-span-2 flex min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">{language.t("tailscale.add.host")}</label>
                  <TextInputV2
                    type="text"
                    appearance="large"
                    class="!w-full self-stretch"
                    value={store.host}
                    placeholder={language.t("tailscale.add.hostPlaceholder")}
                    invalid={!!error()}
                    disabled={busy()}
                    autofocus
                    onInput={(event) => setStore("host", event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                  <Show when={error()}>
                    <span class="settings-v2-server-dialog-error">{error()}</span>
                  </Show>
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.remotePort")}</label>
                  <TextInputV2
                    type="text"
                    appearance="large"
                    class="!w-full self-stretch"
                    value={store.port}
                    disabled={busy()}
                    onInput={(event) => setStore("port", event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                </div>
              </div>
              <div class="flex w-full min-w-0 flex-col gap-2">
                <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.name")}</label>
                <TextInputV2
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={store.name}
                  placeholder={language.t("sshTunnel.add.labelPlaceholder")}
                  disabled={busy()}
                  onInput={(event) => setStore("name", event.currentTarget.value)}
                  onKeyDown={keyDown}
                />
              </div>
              <div class="grid w-full min-w-0 grid-cols-2 gap-4">
                <div class="flex min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.username")}</label>
                  <TextInputV2
                    type="text"
                    appearance="large"
                    class="!w-full self-stretch"
                    value={store.username}
                    disabled={busy()}
                    onInput={(event) => setStore("username", event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
                  <TextInputV2
                    type="password"
                    appearance="large"
                    class="!w-full self-stretch"
                    value={store.password}
                    disabled={busy()}
                    onInput={(event) => setStore("password", event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                </div>
              </div>
            </div>
          </Show>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <Show when={status()?.available}>
          <ButtonV2 variant="contrast" disabled={busy()} onClick={submit}>
            {busy() ? language.t("dialog.server.add.checking") : language.t("sshTunnel.add.button")}
          </ButtonV2>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
