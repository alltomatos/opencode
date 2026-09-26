import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { type Accessor, For, Show, createMemo } from "solid-js"
import type { useServerManagementController } from "@/components/dialog-select-server"
import { DialogServerQrCode } from "@/components/settings-v2/dialog-server-qr-code"
import { DialogRenameServer } from "@/components/settings-v2/dialog-server-rename"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { DialogSshConnectionProgress } from "./dialog-ssh-progress"
import { useSshServers } from "./context"

type Controller = ReturnType<typeof useServerManagementController>

export function isSshTunnelServer(server: ServerConnection.Any) {
  return server.type === "ssh"
}

export function useFilteredSshServers(filter: Accessor<string>) {
  const ssh = useSshServers()
  return createMemo(() => {
    const servers = ssh.data?.servers ?? []
    const query = filter().trim()
    if (!query) return servers
    return fuzzysort.go(query, servers, { keys: [(item) => item.config.host, (item) => item.config.label ?? ""] }).map((x) => x.obj)
  })
}

export function SshServerSettings(props: {
  controller: Controller
  servers: ReturnType<typeof useFilteredSshServers>
}) {
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()
  const server = useServer()
  const api = platform.sshServers

  const request = useMutation(() => ({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const openLogsAndReconnect = (serverId: string, host: string, restart = false) => {
    dialog.show(() => <DialogSshConnectionProgress serverId={serverId} host={host} />)
    if (restart && api) {
      void api.startServer(serverId)
    }
  }

  const openUpdateOpencode = (serverId: string, host: string) => {
    dialog.show(() => <DialogSshConnectionProgress serverId={serverId} host={host} />)
    if (api?.updateServer) {
      void api.updateServer(serverId)
    }
  }

  const openQrCode = (item: { config: { host: string; remotePort: number; serverUsername?: string; serverPassword?: string; label?: string } }) => {
    const conn: ServerConnection.Http = {
      type: "http",
      displayName: item.config.label ?? item.config.host,
      http: {
        url: `http://${item.config.host}:${item.config.remotePort}`,
        username: item.config.serverUsername || "opencode",
        password: item.config.serverPassword || "",
      },
    }
    dialog.show(() => <DialogServerQrCode server={conn} />)
  }

  const openRename = (item: { config: { id: string; host: string; remotePort: number; serverUsername?: string; serverPassword?: string; label?: string } }) => {
    const key = ServerConnection.Key.make(`ssh:${item.config.host}`)
    const conn: ServerConnection.Ssh = {
      type: "ssh",
      host: item.config.host,
      sshServerId: item.config.id,
      displayName: server.getDisplayName(key) ?? item.config.label ?? item.config.host,
      http: {
        url: `http://${item.config.host}:${item.config.remotePort}`,
        username: item.config.serverUsername || "opencode",
        password: item.config.serverPassword || "",
      },
    }
    dialog.show(() => <DialogRenameServer server={conn} />)
  }

  return (
    <Show when={api}>
      <For each={props.servers()}>
        {(item) => {
          const key = ServerConnection.Key.make(`ssh:${item.config.host}`)
          const retryable = item.runtime.kind === "failed" || item.runtime.kind === "stopped"
          const name = () => server.getDisplayName(key) ?? item.config.label ?? item.config.host
          return (
            <div class="settings-v2-servers-row">
              <div class="settings-v2-servers-lead">
                <ServerHealthIndicator health={props.controller.status()[key]} />
                <div class="settings-v2-servers-copy">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="settings-v2-servers-name">{name()}</span>
                    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                      {language.t("sshTunnel.server.label")}
                    </span>
                  </span>
                  <span class="settings-v2-servers-meta">
                    <Show when={item.runtime.kind === "failed"}>
                      {(_) => item.runtime.kind === "failed" && item.runtime.message}
                    </Show>
                  </span>
                </div>
              </div>
              <div class="settings-v2-servers-actions">
                <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                  <Tag>{language.t("dialog.server.status.default")}</Tag>
                </Show>
                <MenuV2 gutter={4} modal={false} placement="bottom-end">
                  <MenuV2.Trigger
                    as={IconButtonV2}
                    variant="ghost-muted"
                    size="small"
                    icon={<IconV2 name="outline-dots" />}
                    aria-label={language.t("common.moreOptions")}
                  />
                  <MenuV2.Portal>
                    <MenuV2.Content>
                      <MenuV2.Group>
                        <MenuV2.GroupLabel>{language.t("sshTunnel.server.menu.label")}</MenuV2.GroupLabel>
                        <MenuV2.Item onSelect={() => openRename(item)}>
                          <IconV2 name="edit" size="small" />
                          {language.t("dialog.server.menu.rename")}
                        </MenuV2.Item>
                        <MenuV2.Item onSelect={() => openQrCode(item)}>
                          <IconV2 name="share" size="small" />
                          {language.t("sshTunnel.server.qrCode")}
                        </MenuV2.Item>
                        <MenuV2.Item onSelect={() => openUpdateOpencode(item.config.id, item.config.host)}>
                          <IconV2 name="reset" size="small" />
                          {language.t("sshTunnel.server.update")}
                        </MenuV2.Item>
                        <MenuV2.Item onSelect={() => openLogsAndReconnect(item.config.id, item.config.host, retryable)}>
                          <IconV2 name="console" size="small" />
                          {language.t("sshTunnel.server.viewLogs")}
                        </MenuV2.Item>
                        <Show when={retryable}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.startServer(item.config.id))}>
                            <IconV2 name="reset" size="small" />
                            {language.t("sshTunnel.server.retryStart")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() !== key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(key)}>
                            <IconV2 name="check" size="small" />
                            {language.t("dialog.server.menu.default")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(null)}>
                            <IconV2 name="close" size="small" />
                            {language.t("dialog.server.menu.defaultRemove")}
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Separator />
                        <MenuV2.Item
                          onSelect={() => api && request.mutate(() => api.removeServer(item.config.id))}
                          class="text-v2-state-fg-danger"
                        >
                          <Icon name="trash" size="small" />
                          {language.t("dialog.server.menu.delete")}
                        </MenuV2.Item>
                      </MenuV2.Group>
                    </MenuV2.Content>
                  </MenuV2.Portal>
                </MenuV2>
              </div>
            </div>
          )
        }}
      </For>
    </Show>
  )
}
