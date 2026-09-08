import { createResource, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"

const NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"

// Mirrors BatutaSidebarList (pages/batuta/batuta-sidebar-list.tsx): a flat
// list that just gets the user into the /agentui page, which owns all the
// actual create/edit/delete actions — same division of labor as Batuta's
// sidebar vs. its main page.
export const AgentUISidebarList: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()

  const [agents] = createResource(async () => {
    const result = await serverSDK().client.agentui.list()
    return result.data ?? []
  })

  return (
    <aside class="mt-2 flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">{language.t("settings.agentui.title")}</div>
        <TooltipV2 placement="bottom" value={language.t("settings.agentui.add.button")}>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="plus" />}
            aria-label={language.t("settings.agentui.add.button")}
            onClick={() => navigate("/agentui")}
          />
        </TooltipV2>
      </div>
      <ScrollView class="min-h-0 min-w-0 shrink">
        <div class="flex min-w-0 flex-col gap-1 pr-3">
          <Show
            when={!agents.loading}
            fallback={<div class="px-1.5 py-2 text-v2-text-text-faint">{language.t("common.loading")}</div>}
          >
            <Show
              when={(agents() ?? []).length > 0}
              fallback={<div class="px-1.5 py-2 text-v2-text-text-faint">{language.t("settings.agentui.empty")}</div>}
            >
              <For each={agents()}>
                {(agent) => (
                  <button
                    type="button"
                    class={`
                      flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px]
                      bg-transparent px-1.5 text-left text-v2-text-text-muted [font-weight:440]
                      transition-[background-color,color] duration-[120ms] ease-in-out
                      hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
                    `}
                    onClick={() => navigate("/agentui")}
                  >
                    <IconV2 name="subagent" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class={NAV_LABEL}>{agent.name}</span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </ScrollView>
    </aside>
  )
}
