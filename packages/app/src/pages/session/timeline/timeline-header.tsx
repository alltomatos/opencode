import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextField } from "@opencode-ai/ui/text-field"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { SessionContextUsage } from "@/components/session-context-usage"
import { isBrowserPanelAvailable, isBrowserPanelOpen, toggleBrowserPanel } from "@/components/browser-panel"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { DialogDeleteSession } from "./dialog-delete-session"
import { DialogBackgroundTasks } from "@/components/session/dialog-background-tasks"
import type { createSessionHeaderActions } from "./timeline-session-actions"

type SessionHeaderActions = ReturnType<typeof createSessionHeaderActions>

export function TimelineHeader(props: {
  parentID: () => string | undefined
  parentTitle: () => string | undefined
  childTitle: () => string | undefined
  shareUrl: () => string | undefined
  shareEnabled: () => boolean
  sessionID: () => string | undefined
  centered: boolean
  actions: SessionHeaderActions
}) {
  const language = useLanguage()
  const settings = useSettings()
  const dialog = useDialog()
  const sessionArchive = useSessionArchive()
  const platform = usePlatform()
  const { view } = useSessionLayout()
  const {
    title,
    setTitle,
    bindTitleRef,
    share,
    setShare,
    shareMutation,
    unshareMutation,
    titleMutation,
    viewShare,
    shareSession,
    unshareSession,
    copyShareUrl,
    selectShareUrlText,
    openTitleEditor,
    closeTitleEditor,
    saveTitleEditor,
    exportSession,
    deleteSession,
    navigateParent,
  } = props.actions
  let more: HTMLButtonElement | undefined

  return (
    <div
      data-session-title
      classList={{
        "sticky top-0 z-30": true,
        "bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)]": settings.general.newLayoutDesigns(),
        "bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": !settings.general.newLayoutDesigns(),
        "w-full": true,
        "pb-4": true,
        "pr-3": true,
        "pl-2.5": settings.general.newLayoutDesigns(),
        "pl-2 md:pl-4": !settings.general.newLayoutDesigns(),
        "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered && !settings.general.newLayoutDesigns(),
      }}
    >
      <div class="h-12 w-full flex items-center justify-between gap-2">
        <div
          classList={{
            "flex items-center gap-1 min-w-0 flex-1": true,
            "pr-3": !settings.general.newLayoutDesigns(),
          }}
        >
          <div class="flex items-center min-w-0 flex-1 w-full">
            <Show when={props.parentID()}>
              <button
                type="button"
                data-slot="session-title-parent"
                class="min-w-0 max-w-[40%] truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                onClick={navigateParent}
              >
                {props.parentTitle()}
              </button>
              <span
                data-slot="session-title-separator"
                class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                aria-hidden="true"
              >
                /
              </span>
            </Show>
            <Show when={props.childTitle() || title.editing}>
              <Show
                when={title.editing}
                fallback={
                  <h1
                    data-slot="session-title-child"
                    classList={{
                      "truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                      "w-fit rounded-[6px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover": settings.general.newLayoutDesigns(),
                      "grow-1 min-w-0": !settings.general.newLayoutDesigns(),
                    }}
                    onClick={openTitleEditor}
                  >
                    {props.childTitle()}
                  </h1>
                }
              >
                <InlineInput
                  ref={bindTitleRef}
                  data-slot="session-title-child"
                  value={title.draft}
                  disabled={titleMutation.isPending}
                  classList={{
                    "block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base": true,
                    "w-full flex-1 grow-1 min-w-0 pl-1 -ml-1 rounded-[6px]": !settings.general.newLayoutDesigns(),
                    "field-sizing-content self-start rounded-[6px] px-2 py-1 ": settings.general.newLayoutDesigns(),
                  }}
                  style={{
                    "--inline-input-shadow": settings.general.newLayoutDesigns() ? "none" : "var(--shadow-xs-border-select)",
                  }}
                  onInput={(event) => setTitle("draft", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void saveTitleEditor()
                      return
                    }
                    if (event.key === "Escape") {
                      event.preventDefault()
                      closeTitleEditor()
                    }
                  }}
                  onBlur={closeTitleEditor}
                />
              </Show>
            </Show>
          </div>
        </div>
        <Show when={props.sessionID()} keyed>
          {(id) => (
            <div
              classList={{
                "shrink-0 flex items-center": true,
                "gap-2": settings.general.newLayoutDesigns(),
                "gap-3": !settings.general.newLayoutDesigns(),
              }}
            >
              <Show when={platform.platform === "desktop"}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  state={view().terminal.opened() ? "pressed" : undefined}
                  aria-label={language.t("session.header.open.app.terminal")}
                  aria-pressed={view().terminal.opened()}
                  icon={<Icon name="terminal" />}
                  onClick={() => view().terminal.toggle()}
                />
              </Show>
              <Show when={isBrowserPanelAvailable()}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  state={isBrowserPanelOpen() ? "pressed" : undefined}
                  aria-label={language.t("browser.panel.toggle")}
                  aria-pressed={isBrowserPanelOpen()}
                  icon={<Icon name="square-arrow-top-right" />}
                  onClick={toggleBrowserPanel}
                />
              </Show>
              <SessionContextUsage placement="bottom" buttonAppearance={settings.general.newLayoutDesigns() ? "v2" : "default"} />
              <Show when={!props.parentID()}>
                <Show
                  when={settings.general.newLayoutDesigns()}
                  fallback={
                    <DropdownMenu
                      gutter={4}
                      placement="bottom-end"
                      open={title.menuOpen}
                      onOpenChange={(open) => {
                        setTitle("menuOpen", open)
                        if (open) return
                      }}
                    >
                      <DropdownMenu.Trigger
                        as={IconButton}
                        icon="dot-grid"
                        variant="ghost"
                        class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                        classList={{
                          "bg-surface-base-active": share.open || title.pendingShare,
                        }}
                        aria-label={language.t("common.moreOptions")}
                        aria-expanded={title.menuOpen || share.open || title.pendingShare}
                        ref={(el: HTMLButtonElement) => {
                          more = el
                        }}
                      />
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          style={{ "min-width": "104px" }}
                          onCloseAutoFocus={(event) => {
                            if (title.pendingRename) {
                              event.preventDefault()
                              setTitle("pendingRename", false)
                              openTitleEditor()
                              return
                            }
                            if (title.pendingShare) {
                              event.preventDefault()
                              requestAnimationFrame(() => {
                                setShare({ open: true, dismiss: null })
                                setTitle("pendingShare", false)
                              })
                            }
                          }}
                        >
                          <DropdownMenu.Item
                            onSelect={() => {
                              setTitle("pendingRename", true)
                              setTitle("menuOpen", false)
                            }}
                          >
                            <IconV2 name="edit" size="small" />
                            <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <Show when={props.shareEnabled()}>
                            <DropdownMenu.Item
                              onSelect={() => {
                                setTitle({ pendingShare: true, menuOpen: false })
                              }}
                            >
                              <IconV2 name="outline-share" size="small" />
                              <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </Show>
                          <DropdownMenu.Item onSelect={() => exportSession(id)}>
                            <Icon name="download" size="small" />
                            <DropdownMenu.ItemLabel>{language.t("common.export")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item onSelect={() => void sessionArchive.archive(id)}>
                            <IconV2 name="archive" size="small" />
                            <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            class="text-text-on-critical-base hover:bg-surface-critical-weak"
                            onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} onDelete={deleteSession} />)}
                          >
                            <Icon name="trash" size="small" />
                            <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu>
                  }
                >
                  <MenuV2
                    gutter={6}
                    placement="bottom-end"
                    open={title.menuOpen}
                    onOpenChange={(open) => {
                      setTitle("menuOpen", open)
                      if (open) return
                    }}
                  >
                    <MenuV2.Trigger
                      as={IconButtonV2}
                      icon={<IconV2 name="outline-dots" />}
                      variant="ghost-muted"
                      size="large"
                      state={share.open || title.pendingShare ? "pressed" : undefined}
                      aria-label={language.t("common.moreOptions")}
                      aria-expanded={title.menuOpen || share.open || title.pendingShare}
                      ref={(el: HTMLButtonElement) => {
                        more = el
                      }}
                    />
                    <MenuV2.Portal>
                      <MenuV2.Content
                        style={{ width: "180px", "min-width": "180px" }}
                        onCloseAutoFocus={(event) => {
                          if (title.pendingRename) {
                            event.preventDefault()
                            setTitle("pendingRename", false)
                            openTitleEditor()
                            return
                          }
                          if (title.pendingShare) {
                            event.preventDefault()
                            requestAnimationFrame(() => {
                              setShare({ open: true, dismiss: null })
                              setTitle("pendingShare", false)
                            })
                          }
                        }}
                      >
                        <MenuV2.Item
                          onSelect={() => {
                            setTitle("pendingRename", true)
                            setTitle("menuOpen", false)
                          }}
                        >
                          <IconV2 name="edit" size="small" />
                          {language.t("common.rename")}
                        </MenuV2.Item>
                        <Show when={props.shareEnabled()}>
                          <MenuV2.Item
                            onSelect={() => {
                              setTitle({ pendingShare: true, menuOpen: false })
                            }}
                          >
                            <IconV2 name="outline-share" size="small" />
                            {language.t("session.share.action.share")}...
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Item onSelect={() => exportSession(id)}>
                          <IconV2 name="outline-square-arrow" size="small" />
                          {language.t("common.export")}...
                        </MenuV2.Item>
                        <MenuV2.Item onSelect={() => void sessionArchive.archive(id)}>
                          <IconV2 name="archive" size="small" />
                          {language.t("common.archive")}
                        </MenuV2.Item>
                        <MenuV2.Item
                          onSelect={() => {
                            setTitle("menuOpen", false)
                            dialog.show(() => <DialogBackgroundTasks />)
                          }}
                        >
                          <IconV2 name="grid-plus" size="small" />
                          {language.t("ui.backgroundTasks.title")}
                        </MenuV2.Item>
                        <MenuV2.Separator />
                        <MenuV2.Item
                          class="text-v2-state-fg-danger"
                          onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} onDelete={deleteSession} />)}
                        >
                          <Icon name="trash" size="small" />
                          {language.t("common.delete")}...
                        </MenuV2.Item>
                      </MenuV2.Content>
                    </MenuV2.Portal>
                  </MenuV2>
                </Show>

                <KobaltePopover
                  open={share.open}
                  anchorRef={() => more}
                  placement="bottom-end"
                  gutter={settings.general.newLayoutDesigns() ? 6 : 4}
                  modal={false}
                  onOpenChange={(open) => {
                    if (open) setShare("dismiss", null)
                    setShare("open", open)
                  }}
                >
                  <KobaltePopover.Portal>
                    <KobaltePopover.Content
                      data-component="popover-content"
                      classList={{
                        "flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]":
                          settings.general.newLayoutDesigns(),
                      }}
                      style={{ "min-width": "320px" }}
                      onEscapeKeyDown={(event) => {
                        setShare({ dismiss: "escape", open: false })
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onPointerDownOutside={() => {
                        setShare({ dismiss: "outside", open: false })
                      }}
                      onFocusOutside={() => {
                        setShare({ dismiss: "outside", open: false })
                      }}
                      onCloseAutoFocus={(event) => {
                        if (share.dismiss === "outside") event.preventDefault()
                        setShare("dismiss", null)
                      }}
                    >
                      <Show
                        when={settings.general.newLayoutDesigns()}
                        fallback={
                          <div class="flex flex-col p-3">
                            <div class="flex flex-col gap-1">
                              <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
                              <div class="text-12-regular text-text-weak">
                                {props.shareUrl()
                                  ? language.t("session.share.popover.description.shared")
                                  : language.t("session.share.popover.description.unshared")}
                              </div>
                            </div>
                            <div class="mt-3 flex flex-col gap-2">
                              <Show
                                when={props.shareUrl()}
                                fallback={
                                  <Button
                                    size="large"
                                    variant="primary"
                                    class="w-full"
                                    onClick={shareSession}
                                    disabled={shareMutation.isPending}
                                  >
                                    {shareMutation.isPending
                                      ? language.t("session.share.action.publishing")
                                      : language.t("session.share.action.publish")}
                                  </Button>
                                }
                              >
                                <div class="flex flex-col gap-2">
                                  <TextField
                                    value={props.shareUrl() ?? ""}
                                    readOnly
                                    copyable
                                    copyKind="link"
                                    tabIndex={-1}
                                    class="w-full"
                                  />
                                  <div class="grid grid-cols-2 gap-2">
                                    <Button
                                      size="large"
                                      variant="secondary"
                                      class="w-full shadow-none border border-border-weak-base"
                                      onClick={unshareSession}
                                      disabled={unshareMutation.isPending}
                                    >
                                      {unshareMutation.isPending
                                        ? language.t("session.share.action.unpublishing")
                                        : language.t("session.share.action.unpublish")}
                                    </Button>
                                    <Button size="large" variant="primary" class="w-full" onClick={viewShare} disabled={unshareMutation.isPending}>
                                      {language.t("session.share.action.view")}
                                    </Button>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        <div class="flex w-full flex-col gap-1.5 px-0.5 pt-0.5">
                          <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
                            {language.t("session.share.popover.title")}
                          </div>
                          <div class="select-none text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-variation-settings:'slnt'_0]">
                            {props.shareUrl()
                              ? language.t("session.share.popover.description.shared")
                              : language.t("session.share.popover.description.unshared")}
                          </div>
                        </div>
                        <div class="flex w-full flex-col gap-2">
                          <Show
                            when={props.shareUrl()}
                            fallback={
                              <ButtonV2 variant="contrast" class="w-full" onClick={shareSession} disabled={shareMutation.isPending}>
                                {shareMutation.isPending
                                  ? language.t("session.share.action.publishing")
                                  : language.t("session.share.action.publish")}
                              </ButtonV2>
                            }
                          >
                            <div class="flex flex-col gap-2">
                              <div
                                class="flex h-8 w-full items-center gap-1.5 rounded-[6px] py-1 pl-2.5 pr-1.5 shadow-[var(--v2-elevation-button-neutral)]"
                                style={{
                                  background:
                                    "linear-gradient(180deg, var(--v2-alpha-light-2) 0%, var(--v2-alpha-light-0) 100%), var(--v2-background-bg-button-neutral)",
                                }}
                              >
                                <div
                                  class="min-w-0 flex-1 truncate select-text cursor-text text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]"
                                  onClick={selectShareUrlText}
                                >
                                  {props.shareUrl()}
                                </div>
                                <IconButtonV2
                                  type="button"
                                  size="small"
                                  variant="ghost-muted"
                                  icon={<IconV2 name="outline-copy" />}
                                  aria-label={language.t("session.share.copy.copyLink")}
                                  onClick={copyShareUrl}
                                />
                                <IconButtonV2
                                  type="button"
                                  size="small"
                                  variant="ghost-muted"
                                  icon={<IconV2 name="outline-square-arrow" />}
                                  aria-label={language.t("session.share.action.view")}
                                  onClick={viewShare}
                                  disabled={unshareMutation.isPending}
                                />
                              </div>
                              <div class="flex w-full">
                                <ButtonV2 variant="outline" class="w-full" onClick={unshareSession} disabled={unshareMutation.isPending}>
                                  {unshareMutation.isPending
                                    ? language.t("session.share.action.unpublishing")
                                    : language.t("session.share.action.unpublish")}
                                </ButtonV2>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </KobaltePopover.Content>
                  </KobaltePopover.Portal>
                </KobaltePopover>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
