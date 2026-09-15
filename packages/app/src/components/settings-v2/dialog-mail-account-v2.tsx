import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { createResource, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

export const DialogMailAccountV2: Component<{ onAdded?: () => void }> = (props) => {
  const dialog = useDialog()
  const serverSDK = useServerSDK()

  const [accounts, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.mailAccounts.list()
    return result.data ?? []
  })

  const [form, setForm] = createStore({
    id: "",
    label: "",
    provider: "",
    host: "",
    port: "993",
    secure: true,
    user: "",
    appPassword: "",
    smtpEnabled: false,
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: false,
    err: {} as { label?: string; host?: string; user?: string; appPassword?: string },
  })

  const resetForm = () =>
    setForm({
      id: "",
      label: "",
      provider: "",
      host: "",
      port: "993",
      secure: true,
      user: "",
      appPassword: "",
      smtpEnabled: false,
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: false,
      err: {},
    })

  const validate = () => {
    const label = form.label.trim()
    const host = form.host.trim()
    const user = form.user.trim()
    const appPassword = form.appPassword.trim()
    const err = {
      label: !label ? "Obrigatório" : undefined,
      host: !host ? "Obrigatório" : undefined,
      user: !user ? "Obrigatório" : undefined,
      appPassword: !appPassword ? "Obrigatório" : undefined,
    }
    setForm("err", err)
    if (err.label || err.host || err.user || err.appPassword) return
    return {
      id: form.id.trim() || user.toLowerCase(),
      label,
      provider: form.provider.trim() || "generic",
      host,
      port: Math.max(1, Number(form.port) || 993),
      secure: form.secure,
      user,
      appPassword,
      smtp: form.smtpEnabled
        ? { host: form.smtpHost.trim(), port: Math.max(1, Number(form.smtpPort) || 587), secure: form.smtpSecure }
        : undefined,
    }
  }

  const addMutation = useMutation(() => ({
    mutationFn: async (input: NonNullable<ReturnType<typeof validate>>) => {
      await serverSDK().client.mailAccounts.add(input)
    },
    onSuccess: () => {
      showToast({ variant: "success", icon: "circle-check", title: "Conta de email salva" })
      resetForm()
      void refetch()
      props.onAdded?.()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível salvar a conta", description: message })
    },
  }))

  const removeMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      await serverSDK().client.mailAccounts.remove({ id })
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Não foi possível remover a conta", description: message })
    },
  }))

  const submit = () => {
    if (addMutation.isPending) return
    const result = validate()
    if (!result) return
    addMutation.mutate(result)
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>Conectar email</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2 overflow-y-auto max-h-[60vh]">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <Show when={(accounts() ?? []).length > 0}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">Contas conectadas</label>
              <div class="flex flex-col gap-1.5">
                <For each={accounts()}>
                  {(account) => (
                    <div class="flex items-center justify-between gap-2 rounded-md bg-v2-background-bg-layer-01 px-2.5 py-1.5">
                      <span class="truncate text-13-regular">
                        {account.label} — {account.user}
                      </span>
                      <IconButtonV2
                        variant="ghost-muted"
                        aria-label="Remover conta"
                        onClick={() => removeMutation.mutate(account.id)}
                        icon={<Icon name="close" size="small" />}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">Nome da conta</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.label}
              placeholder="Ex: Gmail Pessoal"
              invalid={!!form.err.label}
              onInput={(e) => setForm("label", e.currentTarget.value)}
            />
            <Show when={form.err.label}>
              <span class="settings-v2-server-dialog-error">{form.err.label}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 gap-2">
            <div class="flex flex-1 min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">Servidor IMAP (host)</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.host}
                placeholder="imap.gmail.com"
                invalid={!!form.err.host}
                onInput={(e) => setForm("host", e.currentTarget.value)}
              />
              <Show when={form.err.host}>
                <span class="settings-v2-server-dialog-error">{form.err.host}</span>
              </Show>
            </div>
            <div class="flex w-[100px] flex-col gap-2">
              <label class="settings-v2-server-dialog-label">Porta</label>
              <TextInputV2
                type="text"
                inputmode="numeric"
                appearance="large"
                class="!w-full self-stretch"
                value={form.port}
                onInput={(e) => setForm("port", e.currentTarget.value.replace(/\D/g, ""))}
              />
            </div>
          </div>

          <label class="flex items-center gap-2 text-12-regular text-text-weak">
            <SwitchV2 checked={form.secure} onChange={(checked) => setForm("secure", checked)} />
            Conexão segura (TLS)
          </label>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">Usuário</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.user}
              placeholder="voce@gmail.com"
              invalid={!!form.err.user}
              onInput={(e) => setForm("user", e.currentTarget.value)}
            />
            <Show when={form.err.user}>
              <span class="settings-v2-server-dialog-error">{form.err.user}</span>
            </Show>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">Senha de app</label>
            <TextInputV2
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              value={form.appPassword}
              invalid={!!form.err.appPassword}
              onInput={(e) => setForm("appPassword", e.currentTarget.value)}
            />
            <Show when={form.err.appPassword}>
              <span class="settings-v2-server-dialog-error">{form.err.appPassword}</span>
            </Show>
            <span class="settings-v2-server-dialog-hint">
              Para Gmail, gere uma senha de app em myaccount.google.com/apppasswords — não é a sua senha normal.
            </span>
          </div>

          <label class="flex items-center gap-2 text-12-regular text-text-weak">
            <SwitchV2 checked={form.smtpEnabled} onChange={(checked) => setForm("smtpEnabled", checked)} />
            Também enviar emails por essa conta (SMTP)
          </label>

          <Show when={form.smtpEnabled}>
            <div class="flex w-full min-w-0 gap-2">
              <div class="flex flex-1 min-w-0 flex-col gap-2">
                <label class="settings-v2-server-dialog-label">Servidor SMTP (host)</label>
                <TextInputV2
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={form.smtpHost}
                  placeholder="smtp.gmail.com"
                  onInput={(e) => setForm("smtpHost", e.currentTarget.value)}
                />
              </div>
              <div class="flex w-[100px] flex-col gap-2">
                <label class="settings-v2-server-dialog-label">Porta</label>
                <TextInputV2
                  type="text"
                  inputmode="numeric"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={form.smtpPort}
                  onInput={(e) => setForm("smtpPort", e.currentTarget.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
            <label class="flex items-center gap-2 text-12-regular text-text-weak">
              <SwitchV2 checked={form.smtpSecure} onChange={(checked) => setForm("smtpSecure", checked)} />
              Conexão segura (TLS)
            </label>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={addMutation.isPending} onClick={() => dialog.close()}>
          Fechar
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={addMutation.isPending} onClick={submit}>
          {addMutation.isPending ? "Salvando…" : "Adicionar conta"}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
