import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { DialogSshConnectionProgress } from "./dialog-ssh-progress"
import type { SshKeyInfo } from "./types"
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
    certPath: "",
    sshPassword: "",
    remotePort: "4096",
    serverUsername: "opencode",
    serverPassword: "",
    label: "",
    autoSetup: true,
  })

  const keyOptions = createMemo<SshKeyInfo[]>(() => [
    { path: "", name: language.t("sshTunnel.add.keyDefault") },
    ...(keys() ?? []),
  ])

  const certOptions = createMemo<SshKeyInfo[]>(() => [
    { path: "", name: language.t("sshTunnel.add.certDefault") },
    ...(keys() ?? []),
  ])

  const submit = async () => {
    if (!api) return
    if (!store.host.trim()) {
      setError(language.t("sshTunnel.add.error.hostRequired"))
      return
    }
    setBusy(true)
    setError("")
    try {
      const server = await api.addServer({
        host: store.host.trim(),
        port: Number(store.port) || 22,
        sshUsername: store.sshUsername.trim() || "root",
        keyPath: store.keyPath || null,
        certPath: store.certPath || null,
        sshPassword: store.sshPassword || null,
        remotePort: Number(store.remotePort) || 4096,
        serverUsername: store.serverUsername.trim() || "opencode",
        serverPassword: store.serverPassword,
        label: store.label.trim() || undefined,
        autoSetup: store.autoSetup,
      })
      dialog.show(() => <DialogSshConnectionProgress serverId={server.id} host={server.host} />)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog fit class="settings-v2-ssh-dialog">
      <DialogHeader>
        <div class="flex flex-col gap-0.5">
          <DialogTitle>{language.t("sshTunnel.add.title")}</DialogTitle>
          <span class="text-xs text-v2-text-text-muted">
            {language.t("sshTunnel.add.autoSetupHint")}
          </span>
        </div>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-3.5">
        {/* Seção 1: Conexão SSH da VPS */}
        <div class="flex flex-col gap-2.5 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-3">
          <span class="text-xs font-semibold text-v2-text-text-base">
            {language.t("sshTunnel.add.sectionSsh")}
          </span>

          {/* Host + Porta */}
          <div class="flex w-full min-w-0 items-start gap-2.5">
            <div class="flex flex-1 min-w-0 flex-col gap-1.5">
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
            <div class="flex w-24 shrink-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.sshPort")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch text-center"
                value={store.port}
                disabled={busy()}
                onInput={(event) => setStore("port", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </div>

          {/* Usuário SSH + Chave SSH */}
          <div class="grid w-full min-w-0 grid-cols-2 gap-2.5">
            <div class="flex min-w-0 flex-col gap-1.5">
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
            <div class="flex min-w-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.key")}</label>
              <SelectV2
                appearance="large"
                class="!w-full self-stretch"
                options={keyOptions()}
                current={keyOptions().find((k) => k.path === store.keyPath) ?? keyOptions()[0]}
                placeholder={language.t("sshTunnel.add.keyDefault")}
                value={(k) => k.path}
                label={(k) => k.name}
                disabled={busy()}
                onSelect={(k) => setStore("keyPath", k?.path ?? "")}
              />
            </div>
          </div>

          {/* Certificado SSH + Senha SSH */}
          <div class="grid w-full min-w-0 grid-cols-2 gap-2.5">
            <div class="flex min-w-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.cert")}</label>
              <SelectV2
                appearance="large"
                class="!w-full self-stretch"
                options={certOptions()}
                current={certOptions().find((k) => k.path === store.certPath) ?? certOptions()[0]}
                placeholder={language.t("sshTunnel.add.certDefault")}
                value={(k) => k.path}
                label={(k) => k.name}
                disabled={busy()}
                onSelect={(k) => setStore("certPath", k?.path ?? "")}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("sshTunnel.add.sshPassword")}</label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                value={store.sshPassword}
                placeholder="••••••••"
                disabled={busy()}
                onInput={(event) => setStore("sshPassword", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </div>
        </div>

        {/* Seção 2: Servidor OpenCode Remoto */}
        <div class="flex flex-col gap-2.5 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/40 p-3">
          <span class="text-xs font-semibold text-v2-text-text-base">
            {language.t("sshTunnel.add.sectionOpencode")}
          </span>

          <div class="grid w-full min-w-0 grid-cols-2 gap-2.5">
            <div class="flex min-w-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.name")}</label>
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
            <div class="flex min-w-0 flex-col gap-1.5">
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
          </div>

          <div class="grid w-full min-w-0 grid-cols-2 gap-2.5">
            <div class="flex min-w-0 flex-col gap-1.5">
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
            <div class="flex min-w-0 flex-col gap-1.5">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                value={store.serverPassword}
                placeholder="••••••••"
                disabled={busy()}
                onInput={(event) => setStore("serverPassword", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </div>
        </div>

        {/* Seção 3: Card de Setup Automático */}
        <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-v2-border-border-base bg-v2-surface-surface-raised/20 p-2.5 transition-colors hover:bg-v2-surface-surface-raised/40 select-none">
          <input
            type="checkbox"
            checked={store.autoSetup}
            disabled={busy()}
            onChange={(event) => setStore("autoSetup", event.currentTarget.checked)}
            class="mt-0.5 rounded border-v2-border-border-base bg-v2-surface-surface-base"
          />
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-v2-text-text-base">
              {language.t("sshTunnel.add.autoSetup")}
            </span>
            <span class="text-[11px] text-v2-text-text-muted">
              {language.t("sshTunnel.add.autoSetupHint")}
            </span>
          </div>
        </label>
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
