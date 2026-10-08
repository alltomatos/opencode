import { Component, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useUpdaterAction } from "../updater-action"
import { useSettings } from "@/context/settings"
import { useServerSDK } from "@/context/server-sdk"
import { ExternalLink } from "../external-link"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"
import { useMaintenance } from "@/context/maintenance"
import { showToast } from "@/utils/toast"
import { Tag } from "@opencode-ai/ui/tag"
import {
  createAppearanceSettingsController,
  createPermissionScopeController,
  createShellOptions,
  createShellSettingsController,
  createSoundSettingsController,
  soundOptions,
  type AppearanceSettingsController,
  type PermissionScopeController,
  type ShellSettingsController,
  type SoundSettingsController,
} from "./general-controllers"
import "./settings-v2.css"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]
const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
    font: "terminal",
    input: "setTerminal",
  },
} as const
const soundSettings = {
  agent: {
    action: "settings-sounds-agent",
    title: "settings.general.sounds.agent.title",
    description: "settings.general.sounds.agent.description",
  },
  permissions: {
    action: "settings-sounds-permissions",
    title: "settings.general.sounds.permissions.title",
    description: "settings.general.sounds.permissions.description",
  },
  errors: {
    action: "settings-sounds-errors",
    title: "settings.general.sounds.errors.title",
    description: "settings.general.sounds.errors.description",
  },
} as const

const PermissionScopeSetting: Component<{ controller: PermissionScopeController }> = (props) => {
  const language = useLanguage()
  return (
    <SettingsRowV2
      title={
        <span class="flex items-center gap-2">
          <Icon name="shield" class="size-3.5 shrink-0 text-text-weak" />
          {language.t("command.permissions.autoaccept.enable")}
        </span>
      }
      description={language.t("toast.permissions.autoaccept.on.description")}
    >
      <div data-action="settings-auto-accept-permissions">
        <Switch
          checked={props.controller.accepting()}
          disabled={!props.controller.enabled()}
          onChange={props.controller.set}
        />
      </div>
    </SettingsRowV2>
  )
}

const ShellSetting: Component<{ controller: ShellSettingsController }> = (props) => {
  const language = useLanguage()
  const options = createMemo(() =>
    createShellOptions({
      shells: props.controller.shells(),
      current: props.controller.current(),
    }),
  )
  return (
    <SettingsRowV2
      title={
        <span class="flex items-center gap-2">
          <Icon name="console" class="size-3.5 shrink-0 text-text-weak" />
          {language.t("settings.general.row.shell.title")}
        </span>
      }
      description={language.t("settings.general.row.shell.description")}
    >
      <SelectV2
        appearance="inline"
        data-action="settings-shell"
        options={options()}
        current={options().find((option) => option.value === props.controller.current()) ?? options()[0]}
        placement="bottom-end"
        gutter={6}
        value={(option) => option.id}
        label={(option) => {
          if (option.id === "auto") return language.t("settings.general.row.shell.autoDefault")
          if (!option.terminalOnly) return option.name
          return `${option.name} (${language.t("settings.general.row.shell.terminalOnly")})`
        }}
        onSelect={(option) => option && props.controller.select(option.value)}
      />
    </SettingsRowV2>
  )
}

const AppearanceSection: Component<{ controller: AppearanceSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.appearance")}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-color-scheme"
            options={schemeOptions}
            current={schemeOptions.find((option) => option === props.controller.scheme.current())}
            placement="bottom-end"
            gutter={6}
            label={(option) => {
              if (option === "system") return language.t("theme.scheme.system")
              if (option === "light") return language.t("theme.scheme.light")
              return language.t("theme.scheme.dark")
            }}
            onSelect={(option) => option && props.controller.scheme.select(option)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.theme.title")}
          description={
            <>
              {language.t("settings.general.row.theme.description")}{" "}
              <ExternalLink class="settings-v2-link" href="https://opencode.ai/docs/themes/">
                {language.t("common.learnMore")}
              </ExternalLink>
            </>
          }
        >
          <SelectV2
            appearance="inline"
            data-action="settings-theme"
            options={props.controller.theme.options()}
            current={props.controller.theme.current()}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.id}
            label={(option) => option.name}
            onSelect={props.controller.theme.select}
          />
        </SettingsRowV2>

        <FontSetting kind="ui" fonts={props.controller.fonts} />
        <FontSetting kind="code" fonts={props.controller.fonts} />
        <FontSetting kind="terminal" fonts={props.controller.fonts} />
      </SettingsListV2>
    </div>
  )
}

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const language = useLanguage()
  const config = () => fontSettings[props.kind]
  return (
    <SettingsRowV2 title={language.t(config().title)} description={language.t(config().description)}>
      <div class="w-full sm:w-[220px]">
        <TextInputV2
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t(config().title)}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRowV2>
  )
}

const SoundsSection: Component<{ controller: SoundSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.sounds")}</h3>
      <SettingsListV2>
        <SoundSetting kind="agent" channel={props.controller.agent} />
        <SoundSetting kind="permissions" channel={props.controller.permissions} />
        <SoundSetting kind="errors" channel={props.controller.errors} />
      </SettingsListV2>
    </div>
  )
}

const SoundSetting: Component<{
  kind: "agent" | "permissions" | "errors"
  channel: SoundSettingsController["agent"]
}> = (props) => {
  const language = useLanguage()
  const config = () => soundSettings[props.kind]
  return (
    <SettingsRowV2 title={language.t(config().title)} description={language.t(config().description)}>
      <SelectV2
        appearance="inline"
        data-action={config().action}
        options={soundOptions}
        current={props.channel.current()}
        value={(option) => option.id}
        label={(option) => language.t(option.label)}
        onHighlight={props.channel.highlight}
        onSelect={props.channel.select}
        placement="bottom-end"
        gutter={6}
      />
    </SettingsRowV2>
  )
}

const LanguageSetting = () => {
  const language = useLanguage()
  const options = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )
  return (
    <SettingsRowV2
      title={language.t("settings.general.row.language.title")}
      description={language.t("settings.general.row.language.description")}
    >
      <SelectV2
        appearance="inline"
        data-action="settings-language"
        options={options()}
        placement="bottom-end"
        gutter={6}
        current={options().find((option) => option.value === language.locale())}
        value={(option) => option.value}
        label={(option) => option.label}
        onSelect={(option) => option && language.setLocale(option.value)}
      />
    </SettingsRowV2>
  )
}

const CustomSystemPromptSetting = () => {
  const language = useLanguage()
  const settings = useSettings()
  return (
    <div class="flex flex-col gap-2.5 py-4 border-b border-v2-border-border-base last:border-b-0">
      <div class="flex flex-col gap-1">
        <span class="flex items-center gap-2 text-[13px] font-[530] text-v2-text-text-base">
          <Icon name="edit" class="size-3.5 shrink-0 text-text-weak" />
          {language.t("settings.general.row.customSystemPrompt.title")}
        </span>
        <div class="text-[13px] text-text-weak">
          {language.t("settings.general.row.customSystemPrompt.description")}
        </div>
      </div>
      <textarea
        data-action="settings-custom-system-prompt"
        class="w-full min-h-[96px] resize-y rounded-lg border border-v2-border-border-base bg-v2-background-bg-base px-3 py-2 text-[12.5px] text-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus-visible:border-v2-border-border-focus transition-colors"
        placeholder={language.t("settings.general.row.customSystemPrompt.placeholder")}
        value={settings.general.customSystemPrompt()}
        onInput={(e) => settings.general.setCustomSystemPrompt(e.currentTarget.value)}
        rows={4}
      />
    </div>
  )
}

export const SettingsGeneralV2: Component<{
  sessionID?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const settings = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const updater = useUpdaterAction()
  const permissionScope = createPermissionScopeController(() => props.sessionID)
  const shell = createShellSettingsController()
  const appearance = createAppearanceSettingsController()
  const sounds = createSoundSettingsController()
  const desktop = createMemo(() => platform.platform === "desktop")

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => desktop() && "getPinchZoomEnabled" in platform,
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const [debugMode, { mutate: setDebugModeResource }] = createResource(
    () => desktop() && "getDebugModeEnabled" in platform,
    () => Promise.resolve(platform.getDebugModeEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  onMount(() => {
    const unsubscribe = platform.onDebugModeEnabledChanged?.(setDebugModeResource)
    onCleanup(() => unsubscribe?.())
  })

  const onDebugModeChange = (checked: boolean) => {
    setDebugModeResource(checked)
    const update = platform.setDebugModeEnabled?.(checked)
    if (!update) return
    void update.catch(() => setDebugModeResource(!checked))
  }

  const [computerUse, { mutate: setComputerUseResource }] = createResource(
    () => desktop() && "getComputerUseEnabled" in platform,
    () => Promise.resolve(platform.getComputerUseEnabled?.() ?? true).catch(() => true),
    { initialValue: true },
  )

  onMount(() => {
    const unsubscribe = platform.onComputerUseEnabledChanged?.(setComputerUseResource)
    onCleanup(() => unsubscribe?.())
  })

  const onComputerUseChange = (checked: boolean) => {
    setComputerUseResource(checked)
    const update = platform.setComputerUseEnabled?.(checked)
    if (!update) return
    void update.catch(() => setComputerUseResource(!checked))
  }

  const [autoStart, { mutate: setAutoStartResource }] = createResource(
    () => desktop() && "getAutoStartSettings" in platform,
    () =>
      Promise.resolve(
        platform.getAutoStartSettings?.() ?? { openAtLogin: false, openAsHidden: false, closeToTray: false },
      ).catch(() => ({ openAtLogin: false, openAsHidden: false, closeToTray: false })),
    { initialValue: { openAtLogin: false, openAsHidden: false, closeToTray: false } },
  )

  onMount(() => {
    const unsubscribe = platform.onAutoStartSettingsChanged?.(setAutoStartResource)
    onCleanup(() => unsubscribe?.())
  })

  const onStartAtLoginChange = (checked: boolean) => {
    const current = autoStart()
    const next = { ...current, openAtLogin: checked }
    setAutoStartResource(next)
    const update = platform.setAutoStartSettings?.({ openAtLogin: checked })
    if (!update) return
    void Promise.resolve(update).catch(() => setAutoStartResource(current))
  }

  const onStartHiddenChange = (checked: boolean) => {
    const current = autoStart()
    const next = { ...current, openAsHidden: checked }
    setAutoStartResource(next)
    const update = platform.setAutoStartSettings?.({ openAsHidden: checked })
    if (!update) return
    void Promise.resolve(update).catch(() => setAutoStartResource(current))
  }

  const onCloseToTrayChange = (checked: boolean) => {
    const current = autoStart()
    const next = { ...current, closeToTray: checked }
    setAutoStartResource(next)
    const update = platform.setAutoStartSettings?.({ closeToTray: checked })
    if (!update) return
    void Promise.resolve(update).catch(() => setAutoStartResource(current))
  }

  const serverSDK = useServerSDK()

  const [bugReports, { mutate: setBugReportsResource }] = createResource(
    () => serverSDK().client.global.bugRelayTelemetry.get().then((res) => res.data?.enabled ?? true),
    { initialValue: true },
  )

  const onBugReportsChange = (checked: boolean) => {
    setBugReportsResource(checked)
    void serverSDK()
      .client.global.bugRelayTelemetry.set({ enabled: checked })
      .catch(() => setBugReportsResource(!checked))
  }

  const InterfaceSection = () => (
    <LayoutTransitionToggle
      title={language.t("settings.general.row.newInterface.title")}
      badge={language.t("settings.general.row.newInterface.badge")}
      description={language.t("settings.general.row.newInterface.description")}
      checked={settings.general.newLayoutDesigns()}
      onChange={(checked) => {
        settings.general.setNewLayoutDesigns(checked)
        if (checked) return
        void import("@/components/dialog-settings").then((module) => {
          void dialog.show(() => <module.DialogSettings />)
        })
      }}
    />
  )

  const InterfaceNoticeSection = () => (
    <LayoutRetirementNotice
      title={language.t("settings.general.row.newInterfaceNotice.title")}
      description={language.t("settings.general.row.newInterfaceNotice.description")}
      dismiss={language.t("settings.general.row.newInterfaceNotice.dismiss")}
      onDismiss={() => settings.general.dismissNewInterfaceNotice()}
    />
  )

  const GeneralSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.general")}</h3>
      <SettingsListV2>
        <LanguageSetting />

        <CustomSystemPromptSetting />

        <PermissionScopeSetting controller={permissionScope} />

        <ShellSetting controller={shell} />

        <SettingsRowV2
          title={
            <span class="flex items-center gap-2">
              <Icon name="help" class="size-3.5 shrink-0 text-text-weak" />
              {language.t("settings.general.row.reasoningSummaries.title")}
            </span>
          }
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={
            <span class="flex items-center gap-2">
              <Icon name="console" class="size-3.5 shrink-0 text-text-weak" />
              {language.t("settings.general.row.shellToolPartsExpanded.title")}
            </span>
          }
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={
            <span class="flex items-center gap-2">
              <Icon name="edit" class="size-3.5 shrink-0 text-text-weak" />
              {language.t("settings.general.row.editToolPartsExpanded.title")}
            </span>
          }
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={desktop()}>
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name="server" class="size-3.5 shrink-0 text-text-weak" />
                {language.t("settings.general.row.startAtLogin.title")}
              </span>
            }
            description={language.t("settings.general.row.startAtLogin.description")}
          >
            <div data-action="settings-start-at-login">
              <Switch checked={autoStart().openAtLogin} onChange={onStartAtLoginChange} />
            </div>
          </SettingsRowV2>

          <Show when={autoStart().openAtLogin}>
            <SettingsRowV2
              title={
                <span class="flex items-center gap-2">
                  <Icon name="eye" class="size-3.5 shrink-0 text-text-weak" />
                  {language.t("settings.general.row.startHidden.title")}
                </span>
              }
              description={language.t("settings.general.row.startHidden.description")}
            >
              <div data-action="settings-start-hidden">
                <Switch checked={autoStart().openAsHidden} onChange={onStartHiddenChange} />
              </div>
            </SettingsRowV2>
          </Show>

          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name="collapse" class="size-3.5 shrink-0 text-text-weak" />
                {language.t("settings.general.row.closeToTray.title")}
              </span>
            }
            description={language.t("settings.general.row.closeToTray.description")}
          >
            <div data-action="settings-close-to-tray">
              <Switch checked={autoStart().closeToTray} onChange={onCloseToTrayChange} />
            </div>
          </SettingsRowV2>
        </Show>

        <Show when={mobile() && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"}>
          <SettingsRowV2
            title={language.t("settings.general.row.mobileTitlebarBottom.title")}
            description={language.t("settings.general.row.mobileTitlebarBottom.description")}
          >
            <div data-action="settings-mobile-titlebar-bottom">
              <Switch
                checked={settings.general.mobileTitlebarPosition() === "bottom"}
                onChange={(checked) => settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")}
              />
            </div>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )

  const AdvancedSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.advanced")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showCustomAgents.title")}
          description={language.t("settings.general.row.showCustomAgents.description")}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={desktop() && !!platform.setDebugModeEnabled}>
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name="console" class="size-3.5 shrink-0 text-text-weak" />
                {language.t("settings.general.row.debugMode.title")}
              </span>
            }
            description={
              debugMode()
                ? language.t("settings.general.row.debugMode.descriptionOn")
                : language.t("settings.general.row.debugMode.description")
            }
          >
            <div class="flex items-center gap-2">
              <Show when={debugMode()}>
                <ButtonV2
                  variant="neutral"
                  size="small"
                  data-action="settings-restart-for-debug-mode"
                  onClick={() => void platform.restart()}
                >
                  {language.t("settings.general.row.debugMode.restart")}
                </ButtonV2>
              </Show>
              <div data-action="settings-debug-mode">
                <Switch checked={debugMode()} onChange={onDebugModeChange} />
              </div>
            </div>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )

  const ExperimentalSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.experimental")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={
            <span class="flex items-center gap-2">
              <Icon name="dot-grid" class="size-3.5 shrink-0 text-text-weak" />
              {language.t("settings.general.row.use3dAnimations.title")}
            </span>
          }
          description={language.t("settings.general.row.use3dAnimations.description")}
        >
          <div data-action="settings-use-3d-animations">
            <Switch
              checked={settings.general.use3dAnimations()}
              onChange={(checked) => settings.general.setUse3dAnimations(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={desktop() && !!platform.setComputerUseEnabled}>
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name="window-cursor" class="size-3.5 shrink-0 text-text-weak" />
                {language.t("settings.general.row.computerUse.title")}
              </span>
            }
            description={
              computerUse()
                ? language.t("settings.general.row.computerUse.descriptionOn")
                : language.t("settings.general.row.computerUse.description")
            }
          >
            <div class="flex items-center gap-2">
              <Show when={computerUse()}>
                <ButtonV2
                  variant="neutral"
                  size="small"
                  data-action="settings-restart-for-computer-use"
                  onClick={() => void platform.restart()}
                >
                  {language.t("settings.general.row.computerUse.restart")}
                </ButtonV2>
              </Show>
              <div data-action="settings-computer-use">
                <Switch checked={computerUse()} onChange={onComputerUseChange} />
              </div>
            </div>
          </SettingsRowV2>
        </Show>

        <SettingsRowV2
          title={
            <span class="flex items-center gap-2">
              <Icon name="warning" class="size-3.5 shrink-0 text-text-weak" />
              {language.t("settings.general.row.bugReports.title")}
            </span>
          }
          description={language.t("settings.general.row.bugReports.description")}
        >
          <div data-action="settings-bug-reports">
            <Switch checked={bugReports()} onChange={onBugReportsChange} />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const NotificationsSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.notifications")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const UpdatesSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.updates")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <ButtonV2 size="normal" variant="neutral" disabled={!updater.action().run} onClick={() => updater.run()}>
            {language.t(updater.action().label)}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const maintenance = useMaintenance()

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return "0 MB"
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleRunMaintenance = async () => {
    const res = await maintenance.run({ purgeOldSessions: false, fullVacuum: false })
    if (res) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.maintenance.toast.success.title"),
        description: language.t("settings.maintenance.toast.success.description", {
          freed: formatSize(res.freedBytes),
          duration: res.durationMs,
        }),
      })
    }
  }

  const [deepMaintenanceRunning, setDeepMaintenanceRunning] = createSignal(false)

  const handleDeepMaintenanceAndRelaunch = async () => {
    if (deepMaintenanceRunning()) return
    setDeepMaintenanceRunning(true)
    try {
      showToast({
        variant: "loading",
        title: language.t("settings.maintenance.action.deep"),
        description: language.t("settings.maintenance.action.optimizing"),
      })
      // Executa expurgo de sessões com mais de 30 dias + VACUUM completo
      await maintenance.run({ purgeOldSessions: true, maxAgeDays: 30, fullVacuum: true })
      // Reinicia o app
      if (platform.restart) {
        await platform.restart()
      }
    } finally {
      setDeepMaintenanceRunning(false)
    }
  }

  const MaintenanceSection = () => (
    <Show when={desktop()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.maintenance.section.title")}</h3>

        <SettingsListV2>
          <SettingsRowV2
            title={
              <div class="flex items-center gap-2">
                <span>{language.t("settings.maintenance.row.title")}</span>
                <Show when={maintenance.needsMaintenance()}>
                  <Tag>{language.t("settings.maintenance.badge.needed")}</Tag>
                </Show>
              </div>
            }
            description={
              <div class="flex flex-col gap-0.5">
                <span>{language.t("settings.maintenance.row.description")}</span>
                <Show when={maintenance.status()}>
                  {(st) => (
                    <span class="text-11-regular text-v2-text-text-muted">
                      BD: {formatSize(st().dbSizeBytes)} | WAL: {formatSize(st().walSizeBytes)} | Eventos: {st().eventCount}
                    </span>
                  )}
                </Show>
              </div>
            }
          >
            <div class="flex items-center gap-2">
              <ButtonV2
                size="normal"
                variant="neutral"
                disabled={maintenance.running() || deepMaintenanceRunning()}
                onClick={handleRunMaintenance}
              >
                {maintenance.running()
                  ? language.t("settings.maintenance.action.optimizing")
                  : language.t("settings.maintenance.action.optimize")}
              </ButtonV2>
              <ButtonV2
                size="normal"
                variant={maintenance.needsMaintenance() ? "contrast" : "neutral"}
                disabled={maintenance.running() || deepMaintenanceRunning()}
                onClick={handleDeepMaintenanceAndRelaunch}
              >
                {deepMaintenanceRunning()
                  ? language.t("settings.maintenance.action.optimizing")
                  : language.t("settings.maintenance.action.deep")}
              </ButtonV2>
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )

  // We can probably remove this, right?
  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.general.section.display")}</h3>

        <SettingsListV2>
          <SettingsRowV2
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.general")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection controller={appearance} />

        <NotificationsSection />

        <SoundsSection controller={sounds} />

        <Show when={desktop()}>
          <UpdatesSection />
          <MaintenanceSection />
        </Show>

        <DisplaySection />

        <ExperimentalSection />

        <AdvancedSection />
      </div>
    </>
  )
}
