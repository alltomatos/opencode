import { For, Show, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import type { BatutaActivity, SessionStatus } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "@/components/settings-v2/parts/list"
import { SettingsRowV2 } from "@/components/settings-v2/parts/row"
import { createBatutaActivityNodes } from "./use-activity-nodes"

const statusKey = (status: SessionStatus["type"]) => `batuta.panel.status.${status}` as const

export const BatutaActivityPanel2D: Component<{
  orchestratorSessionID: string
  activity: BatutaActivity
}> = (props) => {
  const language = useLanguage()
  const nodes = createBatutaActivityNodes(props)

  return (
    <SettingsListV2>
      <For each={nodes()}>
        {(node) => (
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                <Icon name={node.isOrchestrator ? "task" : "subagent"} class="size-3.5 shrink-0 text-text-weak" />
                {node.label}
              </span>
            }
            description={
              <Show
                when={node.tool}
                fallback={<span class="text-text-weak">{language.t(statusKey(node.status.type))}</span>}
              >
                {(tool) => (
                  <span class="flex items-center gap-1.5 text-text-weak">
                    <Icon name={tool().icon} class="size-3.5 shrink-0" />
                    {tool().title}
                    <Show when={tool().subtitle}>
                      <span class="truncate opacity-70">{tool().subtitle}</span>
                    </Show>
                  </span>
                )}
              </Show>
            }
          >
            <Tag>{language.t(statusKey(node.status.type))}</Tag>
          </SettingsRowV2>
        )}
      </For>
    </SettingsListV2>
  )
}
