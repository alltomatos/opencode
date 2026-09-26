import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useQueryClient } from "@tanstack/solid-query"
import { type Component, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { sshServersQueryKey } from "@/ssh-tunnel/context"
import type { SshServersState } from "@/ssh-tunnel/types"
import "./settings-v2.css"

export interface DialogRenameServerProps {
  server: ServerConnection.Any
  onRenamed?: (newName: string) => void
}

export const DialogRenameServer: Component<DialogRenameServerProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const queryClient = useQueryClient()

  const currentDisplayName = () => {
    const key = ServerConnection.key(props.server)
    const custom = server.getDisplayName(key)
    if (custom) return custom
    if (props.server.type === "ssh") {
      return props.server.displayName ?? props.server.host
    }
    return props.server.displayName ?? serverName(props.server)
  }

  const [name, setName] = createSignal(currentDisplayName())
  const [busy, setBusy] = createSignal(false)

  const submit = async () => {
    const newName = name().trim()
    setBusy(true)
    try {
      const key = ServerConnection.key(props.server)
      server.rename(key, newName)
      if (props.server.type === "ssh") {
        const sshId = props.server.sshServerId
        if (sshId && platform.sshServers?.renameServer) {
          try {
            await platform.sshServers.renameServer(sshId, newName)
          } catch {
            // Ignora falha de IPC se o handler ainda não foi carregado pelo processo principal
          }
        }
        queryClient.setQueryData(sshServersQueryKey, (old: SshServersState | undefined) => {
          if (!old) return old
          return {
            ...old,
            servers: old.servers.map((s) =>
              s.config.id === sshId || s.config.host === (props.server as ServerConnection.Ssh).host
                ? { ...s, config: { ...s.config, label: newName || undefined } }
                : s,
            ),
          }
        })
      } else if (props.server.type === "http") {
        server.add({
          ...props.server,
          displayName: newName || undefined,
        })
      }
      props.onRenamed?.(newName)
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
        <DialogTitle>{language.t("dialog.server.rename.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.name")}</label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            value={name()}
            placeholder={language.t("dialog.server.rename.placeholder")}
            disabled={busy()}
            autofocus
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={keyDown}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy()} onClick={submit}>
          {busy() ? language.t("dialog.server.add.checking") : language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
