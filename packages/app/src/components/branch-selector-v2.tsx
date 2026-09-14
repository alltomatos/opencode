import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { errorMessage } from "@/pages/layout/helpers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"

export interface BranchSelectorV2Props {
  readonly branch?: string
  readonly directory?: string
  readonly placement?: "top" | "bottom"
  readonly class?: string
  readonly onBranchChange?: (branch: string) => void
}

function DialogConfirmSwitchBranch(props: {
  branch: string
  directory: string
  onConfirm: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={language.t("session.git.switchConfirmTitle")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("session.git.switchConfirmDesc", { branch: props.branch })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => {
              dialog.close()
              props.onConfirm()
            }}
          >
            {language.t("session.git.switchConfirmButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function BranchSelectorV2(props: BranchSelectorV2Props) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [switching, setSwitching] = createSignal(false)
  const [open, setOpen] = createSignal(false)

  const isGit = createMemo(() => sync().project?.vcs === "git")
  const targetDir = createMemo(() => props.directory ?? sdk().directory)
  const currentBranch = createMemo(() => props.branch ?? sync().data.vcs?.branch)

  const [branches, { refetch }] = createResource(
    () => (open() && isGit() ? targetDir() : false),
    async (dir) => {
      if (!dir) return []
      try {
        const res = await sdk().client.vcs.branches({ directory: dir })
        return (res.data ?? []).filter(Boolean)
      } catch {
        return []
      }
    },
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void refetch()
    }
  }

  const executeCheckout = async (branchName: string) => {
    try {
      const res = await sdk().client.vcs.checkout({
        branch: branchName,
        directory: targetDir(),
      })
      if (res.error) {
        const msg = (res.error as { message?: string })?.message ?? language.t("session.git.checkoutFailed")
        showToast({
          title: language.t("session.git.checkoutFailed"),
          description: msg,
        })
      } else {
        props.onBranchChange?.(branchName)
      }
    } catch (err) {
      showToast({
        title: language.t("session.git.checkoutFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
    } finally {
      setSwitching(false)
    }
  }

  const switchBranch = async (branchName: string) => {
    if (branchName === currentBranch() || switching()) return
    setSwitching(true)

    try {
      const status = await sdk().client.vcs.status({ directory: targetDir() })
      if (status.data && status.data.length > 0) {
        dialog.show(() => (
          <DialogConfirmSwitchBranch
            branch={branchName}
            directory={targetDir()}
            onConfirm={() => void executeCheckout(branchName)}
          />
        ))
        setSwitching(false)
        return
      }
    } catch {
      // ignore status check failure and try to check out anyway
    }

    await executeCheckout(branchName)
  }

  return (
    <Show when={isGit()}>
      <MenuV2
        placement={props.placement ?? "top"}
        gutter={4}
        onOpenChange={handleOpenChange}
      >
        <MenuV2.Trigger
          class={`flex h-6 min-w-0 max-w-[200px] items-center gap-1.5 rounded-md px-1.5 text-xs font-mono transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed text-v2-text-text-muted hover:text-v2-text-text-base ${
            props.class ?? ""
          }`}
          title={language.t("session.git.switchBranch")}
          aria-label={language.t("session.git.switchBranch")}
          disabled={switching()}
        >
          <Show
            when={!switching()}
            fallback={<Spinner class="size-3 text-v2-icon-icon-muted shrink-0" />}
          >
            <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          </Show>
          <span class="min-w-0 truncate font-medium">
            {currentBranch() ?? "..."}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 opacity-60 text-v2-icon-icon-muted" />
        </MenuV2.Trigger>

        <MenuV2.Portal>
          <MenuV2.Content class="min-w-[180px] max-w-[280px] max-h-[260px] overflow-y-auto">
            <MenuV2.Group>
              <MenuV2.GroupLabel>{language.t("session.git.branches")}</MenuV2.GroupLabel>
              <Show
                when={!branches.loading && (branches() ?? []).length > 0}
                fallback={
                  <div class="px-2 py-3 text-center text-xs text-v2-text-text-faint">
                    <Show when={branches.loading} fallback={<span>-</span>}>
                      <Spinner class="inline-block size-3.5 mr-1.5" />
                    </Show>
                  </div>
                }
              >
                <For each={branches() ?? []}>
                  {(branchItem) => {
                    const isCurrent = () => branchItem === currentBranch()
                    const isProtected = () =>
                      branchItem === "main" || branchItem === "master" || branchItem === "dev"

                    return (
                      <MenuV2.Item
                        onSelect={() => void switchBranch(branchItem)}
                        class={`flex items-center gap-2 font-mono text-xs ${
                          isProtected() && !isCurrent() ? "text-v2-text-text-warning hover:text-v2-text-text-warning" : ""
                        }`}
                      >
                        <Icon name="branch" size="small" class="shrink-0 opacity-80" />
                        <span class="min-w-0 flex-1 truncate">{branchItem}</span>
                        <Show when={isCurrent()}>
                          <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-info" />
                        </Show>
                      </MenuV2.Item>
                    )
                  }}
                </For>
              </Show>
            </MenuV2.Group>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
