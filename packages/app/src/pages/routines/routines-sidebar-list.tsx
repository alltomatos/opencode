import { createResource, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useServerSDK } from "@/context/server-sdk"
import { triggerSummary } from "./summary"

const NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"

export const RoutinesSidebarList: Component = () => {
  const serverSDK = useServerSDK()
  const navigate = useNavigate()

  const [schedules] = createResource(async () => {
    const result = await serverSDK().client.v2.schedule.list()
    return result.data ?? []
  })

  return (
    <aside class="mt-2 flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">Rotinas</div>
        <TooltipV2 placement="bottom" value="Nova rotina">
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<Icon name="plus" />}
            aria-label="Nova rotina"
            onClick={() => navigate("/rotinas/new")}
          />
        </TooltipV2>
      </div>
      <ScrollView class="min-h-0 min-w-0 shrink">
        <div class="flex min-w-0 flex-col gap-1 pr-3">
          <Show
            when={!schedules.loading}
            fallback={<div class="px-1.5 py-2 text-v2-text-text-faint">Carregando…</div>}
          >
            <Show
              when={(schedules() ?? []).length > 0}
              fallback={<div class="px-1.5 py-2 text-v2-text-text-faint">Nenhuma rotina ainda.</div>}
            >
              <For each={schedules()}>
                {(schedule) => (
                  <button
                    type="button"
                    class={`
                      flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px]
                      bg-transparent px-1.5 text-left text-v2-text-text-muted [font-weight:440]
                      transition-[background-color,color] duration-[120ms] ease-in-out
                      hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
                    `}
                    onClick={() => navigate("/rotinas")}
                  >
                    <Icon name="task" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class={NAV_LABEL}>{triggerSummary(schedule.trigger)}</span>
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
