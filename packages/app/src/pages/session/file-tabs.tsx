import { Show } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useSettings } from "@/context/settings"
import { SessionFileViewV1 } from "./file-tab-view-v1"
import { SessionFileViewV2 } from "./file-tab-view-v2"

type SessionFileViewProps = {
  tab: string
}

export function FileTabContent(props: { tab: string }) {
  return (
    <Tabs.Content value={props.tab}>
      <SessionFileView tab={props.tab} />
    </Tabs.Content>
  )
}

export function SessionFileView(props: SessionFileViewProps) {
  const settings = useSettings()

  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={<SessionFileViewV1 tab={props.tab} />}>
      <SessionFileViewV2 tab={props.tab} />
    </Show>
  )
}
