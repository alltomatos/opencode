import type { Component } from "solid-js"
import { SettingsAgentUIV2 } from "@/components/settings-v2/agentui"
import "@/components/settings-v2/settings-v2.css"

export const AgentUIPage: Component = () => {
  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="settings-v2-panel">
        <SettingsAgentUIV2 />
      </div>
    </div>
  )
}
