import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSshServers } from "./context"
import type { SshLogEntry, SshSetupStep, SshStepStatus } from "./types"

const STEPS: { key: SshSetupStep; labelKey: string }[] = [
  { key: "test_ssh", labelKey: "sshTunnel.progress.step.testSsh" },
  { key: "check_install", labelKey: "sshTunnel.progress.step.checkInstall" },
  { key: "start_service", labelKey: "sshTunnel.progress.step.startService" },
  { key: "tunnel", labelKey: "sshTunnel.progress.step.tunnel" },
]

export function DialogSshConnectionProgress(props: { serverId?: string; host?: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const ssh = useSshServers()
  const api = platform.sshServers

  const progress = createMemo(() => ssh.data?.progress)
  const targetServer = createMemo(() => {
    const id = props.serverId ?? progress()?.serverId
    if (!id) return undefined
    return ssh.data?.servers.find((s) => s.config.id === id)
  })

  let logContainerRef: HTMLDivElement | undefined

  createEffect(() => {
    const logs = progress()?.logs
    if (logs && logs.length > 0 && logContainerRef) {
      logContainerRef.scrollTop = logContainerRef.scrollHeight
    }
  })

  const retry = async () => {
    const id = props.serverId ?? targetServer()?.config.id
    if (!id || !api) return
    try {
      await api.startServer(id)
    } catch {
      // errors handled by state updates
    }
  }

  const close = () => {
    dialog.close()
  }

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp)
    return d.toTimeString().split(" ")[0]
  }

  const stepStatus = (key: SshSetupStep): SshStepStatus => {
    const prog = progress()
    if (!prog) return "pending"
    return prog.steps?.[key]?.status ?? "pending"
  }

  return (
    <Dialog fit class="settings-v2-ssh-dialog">
      <DialogHeader hideClose={true}>
        <div class="flex w-full items-center justify-between">
          <DialogTitle>{language.t("sshTunnel.progress.title")}</DialogTitle>
          <Show when={targetServer()}>
            {(server) => (
              <span class="rounded bg-v2-surface-elevation-raised px-2 py-0.5 text-xs text-v2-text-text-muted">
                {server().config.label || server().config.host}
              </span>
            )}
          </Show>
        </div>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2">
        {/* Step Indicators */}
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <For each={STEPS}>
            {(step, index) => {
              const status = () => stepStatus(step.key)
              return (
                <div
                  class="flex flex-col items-center gap-1.5 rounded-lg border border-v2-border-border-base p-2 text-center"
                  classList={{
                    "border-v2-state-fg-success bg-v2-state-fg-success/5": status() === "done",
                    "border-v2-state-fg-danger bg-v2-state-fg-danger/5": status() === "failed",
                    "border-v2-border-border-strong bg-v2-surface-elevation-base": status() === "running",
                    "opacity-50": status() === "pending",
                  }}
                >
                  <div class="flex h-6 w-6 items-center justify-center">
                    <Show when={status() === "done"}>
                      <span class="text-v2-state-fg-success">
                        <IconV2 name="check" size="small" />
                      </span>
                    </Show>
                    <Show when={status() === "running"}>
                      <LoaderV2 />
                    </Show>
                    <Show when={status() === "failed"}>
                      <span class="text-v2-state-fg-danger">
                        <IconV2 name="close" size="small" />
                      </span>
                    </Show>
                    <Show when={status() === "pending"}>
                      <span class="text-xs font-semibold text-v2-text-text-muted">{index() + 1}</span>
                    </Show>
                  </div>
                  <span class="text-[11px] font-medium leading-tight text-v2-text-text-base">
                    {language.t(step.labelKey)}
                  </span>
                </div>
              )
            }}
          </For>
        </div>

        {/* Live Logs Terminal */}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-v2-text-text-muted">{language.t("sshTunnel.progress.logs")}</span>
          <div
            ref={logContainerRef}
            class="h-44 w-full overflow-y-auto rounded-lg border border-v2-border-border-base bg-[#0f141c] p-3 font-mono text-[11px] leading-relaxed text-[#c9d1d9] select-text"
          >
            <Show
              when={progress()?.logs && progress()!.logs.length > 0}
              fallback={
                <div class="flex h-full items-center justify-center text-v2-text-text-faint">
                  {language.t("sshTunnel.progress.connecting")}
                </div>
              }
            >
              <For each={progress()?.logs}>
                {(log: SshLogEntry) => (
                  <div class="flex items-start gap-2 whitespace-pre-wrap break-all py-0.5">
                    <span class="shrink-0 text-neutral-500">[{formatTime(log.timestamp)}]</span>
                    <span
                      classList={{
                        "text-emerald-400 font-semibold": log.level === "success",
                        "text-red-400 font-semibold": log.level === "error",
                        "text-amber-400": log.level === "stderr",
                        "text-sky-300": log.level === "info",
                        "text-neutral-300": log.level === "stdout",
                      }}
                    >
                      {log.message}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Error message banner if failed */}
        <Show when={progress()?.completed && !progress()?.success && progress()?.error}>
          {(err) => (
            <div class="rounded-lg border border-v2-state-fg-danger/30 bg-v2-state-fg-danger/10 p-3 text-xs text-v2-state-fg-danger">
              <span class="font-semibold">{language.t("sshTunnel.progress.failed")}: </span>
              <span>{err()}</span>
            </div>
          )}
        </Show>
      </DialogBody>
      <DialogFooter>
        <Show
          when={progress()?.completed}
          fallback={
            <ButtonV2 variant="neutral" onClick={close}>
              {language.t("common.close")}
            </ButtonV2>
          }
        >
          <Show
            when={progress()?.success}
            fallback={
              <div class="flex w-full items-center justify-end gap-2">
                <ButtonV2 variant="neutral" onClick={close}>
                  {language.t("sshTunnel.progress.close")}
                </ButtonV2>
                <ButtonV2 variant="contrast" onClick={retry}>
                  {language.t("sshTunnel.progress.retry")}
                </ButtonV2>
              </div>
            }
          >
            <ButtonV2 variant="contrast" onClick={close}>
              {language.t("sshTunnel.progress.done")}
            </ButtonV2>
          </Show>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
