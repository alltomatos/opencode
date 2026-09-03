import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import "@/components/settings-v2/settings-v2.css"

export function DialogAddSshTunnelServer() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const api = platform.sshServers

  const [keys] = createResource(async () => (await api?.listKeys()) ?? [])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [store, setStore] = createStore({
    host: "",
    port: "22",
    sshUsername: "root",
    keyPath: "",
    remotePort: "4096",
    serverUsername: "opencode",
    serverPassword: "",
    label: "",
  })

  const submit = async () => {
    if (!api) return
    if (!store.host.trim()) {
      setError(language.t("sshTunnel.add.error.hostRequired"))
      return
    }
    setBusy(true)
    setError("")
    try {
      await api.addServer({
        host: store.host.trim(),
        port: Number(store.port) || 22,
        sshUsername: store.sshUsername.trim() || "root",
        keyPath: store.keyPath || null,
        remotePort: Number(store.remotePort) || 4096,
        serverUsername: store.serverUsername.trim() || "opencode",
        serverPassword: store.serverPassword,
        label: store.label.trim() || undefined,
      })
      dialog.close()
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
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
        <DialogTitle>{language.t("sshTunnel.add.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="grid w-full min-w-0 grid-cols-3 gap-4">
            <div class="col-span-2 flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.host")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.host}
                placeholder={language.t("sshTunnel.add.hostPlaceholder")}
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
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.sshPort")}</label>
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

          <div class="grid w-full min-w-0 grid-cols-2 gap-4">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.sshUsername")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.sshUsername}
                disabled={busy()}
                onInput={(event) => setStore("sshUsername", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.key")}</label>
              <select
                class="settings-v2-server-dialog-select"
                value={store.keyPath}
                disabled={busy()}
                onChange={(event) => setStore("keyPath", event.currentTarget.value)}
              >
                <option value="">{language.t("sshTunnel.add.keyDefault")}</option>
                <For each={keys()}>{(key) => <option value={key.path}>{key.name}</option>}</For>
              </select>
            </div>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.label")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={store.label}
              placeholder={language.t("sshTunnel.add.labelPlaceholder")}
              disabled={busy()}
              onInput={(event) => setStore("label", event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>

          <DividerV2 />

          <div class="grid w-full min-w-0 grid-cols-3 gap-4">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.remotePort")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.remotePort}
                disabled={busy()}
                onInput={(event) => setStore("remotePort", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.username")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.serverUsername}
                disabled={busy()}
                onInput={(event) => setStore("serverUsername", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                value={store.serverPassword}
                disabled={busy()}
                onInput={(event) => setStore("serverPassword", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy()} onClick={submit}>
          {busy() ? language.t("dialog.server.add.checking") : language.t("sshTunnel.add.button")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
