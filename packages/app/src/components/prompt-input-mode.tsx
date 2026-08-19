import { createMemo, For, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Icon as IconLegacy } from "@opencode-ai/ui/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import type { usePermission } from "@/context/permission"
import type { PromptInputControls } from "@/components/prompt-input/contracts"

type ModeID = "auto" | "manual" | "edits" | "plan" | "bypass"

const MODES: {
  id: ModeID
  agent: "build" | "plan"
  level: boolean | "edits"
  scope: "session" | "directory"
  icon: IconLegacyName
}[] = [
  { id: "auto", agent: "build", level: true, scope: "session", icon: "check" },
  { id: "manual", agent: "build", level: false, scope: "session", icon: "eye" },
  { id: "edits", agent: "build", level: "edits", scope: "session", icon: "code" },
  { id: "plan", agent: "plan", level: false, scope: "session", icon: "checklist" },
  { id: "bypass", agent: "build", level: true, scope: "directory", icon: "warning" },
]

type IconLegacyName = Parameters<typeof IconLegacy>[0]["name"]

const modeIcon = (id: ModeID) => MODES.find((mode) => mode.id === id)?.icon ?? "check"

export function PromptInputV2ModeControl(props: {
  agent: PromptInputControls["agents"]
  permission: ReturnType<typeof usePermission>
  sessionID?: string
  directory: string
}) {
  const language = useLanguage()

  // "plan" is a built-in mode, not a custom agent — it should stay offered
  // here even when the (custom-agent-only) agent switcher itself is hidden.
  const available = createMemo(() =>
    MODES.filter((mode) => mode.agent === "build" || props.agent.options.includes(mode.agent)),
  )
  const sessionModes = createMemo(() => available().filter((mode) => mode.scope === "session"))
  const directoryModes = createMemo(() => available().filter((mode) => mode.scope === "directory"))

  const currentModeID = createMemo<ModeID>(() => {
    if (props.agent.current === "plan") return "plan"
    const sessionLevel = props.sessionID
      ? props.permission.sessionOnlyAutoAcceptLevel(props.sessionID, props.directory)
      : undefined
    const resolved = sessionLevel !== undefined ? sessionLevel : props.permission.directoryAutoAcceptLevel(props.directory)
    if (resolved === "edits") return "edits"
    if (resolved === true) return sessionLevel === undefined ? "bypass" : "auto"
    return "manual"
  })

  const selectMode = (id: ModeID) => {
    const mode = MODES.find((item) => item.id === id)
    if (!mode) return
    if (props.agent.current !== mode.agent && props.agent.options.includes(mode.agent)) {
      props.agent.select(mode.agent)
    }
    if (!props.sessionID) {
      if (mode.scope === "directory") props.permission.setAutoAcceptDirectory(props.directory, mode.level)
      return
    }
    if (mode.scope === "directory") {
      props.permission.clearAutoAccept(props.sessionID, props.directory)
      props.permission.setAutoAcceptDirectory(props.directory, mode.level)
      return
    }
    props.permission.setAutoAccept(props.sessionID, props.directory, mode.level)
  }

  const modeItem = (mode: (typeof MODES)[number]) => (
    <MenuV2.RadioItem value={mode.id} class="!h-auto items-start gap-2.5 py-2" closeOnSelect>
      <div
        class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[6px]"
        classList={{
          "bg-v2-background-bg-layer-02 text-v2-icon-icon-muted": mode.id !== "bypass",
          "bg-v2-state-bg-warning text-v2-state-fg-warning": mode.id === "bypass",
        }}
      >
        <IconLegacy name={mode.icon} class="size-3.5" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="min-w-0 truncate leading-4">{language.t(`prompt.mode.${mode.id}.label`)}</span>
        <span class="min-w-0 truncate text-[11px] leading-3 text-v2-text-text-muted">
          {language.t(`prompt.mode.${mode.id}.description`)}
        </span>
      </div>
    </MenuV2.RadioItem>
  )

  return (
    <Show when={!props.agent.loading && available().length > 1}>
      <TooltipV2 placement="top" value={language.t("prompt.mode.select.title")}>
        <MenuV2 gutter={6} modal={false} placement="top-start">
          <MenuV2.Trigger
            as={ButtonV2}
            variant="ghost-muted"
            size="normal"
            class="min-w-0 max-w-[180px] justify-start gap-1.5 ![font-weight:440]"
            aria-label={language.t("prompt.mode.select.title")}
          >
            <span
              class="flex shrink-0"
              classList={{
                "text-v2-state-fg-warning": currentModeID() === "bypass",
                "text-v2-icon-icon-muted": currentModeID() !== "bypass",
              }}
            >
              <IconLegacy name={modeIcon(currentModeID())} class="size-3.5" />
            </span>
            <span class="truncate leading-5">{language.t(`prompt.mode.${currentModeID()}.label`)}</span>
            <span class="-ms-0.5 -me-1 ml-auto flex shrink-0">
              <Icon name="chevron-down" />
            </span>
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content style={{ "min-width": "290px" }}>
              <MenuV2.RadioGroup value={currentModeID()} onChange={(value) => selectMode(value as ModeID)}>
                <For each={sessionModes()}>{modeItem}</For>
                <Show when={directoryModes().length > 0}>
                  <MenuV2.Separator />
                  <MenuV2.GroupLabel>{language.t("prompt.mode.group.directory")}</MenuV2.GroupLabel>
                  <For each={directoryModes()}>{modeItem}</For>
                </Show>
              </MenuV2.RadioGroup>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </TooltipV2>
    </Show>
  )
}
