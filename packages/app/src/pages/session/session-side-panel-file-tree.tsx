import { Match, Show, Switch } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"

import FileTree from "@/components/file-tree"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import type { Sizing } from "@/pages/session/helpers"

const FILE_TREE_WIDTH_MIN = 240

export function SessionSidePanelFileTree(props: {
  reviewOpen: () => boolean
  fileOpen: () => boolean
  treeWidth: () => string
  size: Sizing
  reviewCount: () => number
  hasReview: () => boolean
  diffsReady: () => boolean
  diffFiles: () => string[]
  kinds: () => Map<string, "add" | "del" | "mix">
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  onOpenTab: (tab: string) => void
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()

  const fileTreeTab = () => layout.fileTree.tab()
  const fileTreeWidth = () => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width())

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const nofiles = () => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  }

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  return (
    <Show when={props.fileOpen()}>
      <div
        id="file-tree-panel"
        class="relative min-w-0 h-full shrink-0 overflow-hidden"
        classList={{
          "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: props.treeWidth() }}
      >
        <div
          class="h-full flex flex-col overflow-hidden group/filetree"
          classList={{ "border-l border-border-weaker-base": props.reviewOpen() }}
        >
          <Tabs
            variant="pill"
            value={fileTreeTab()}
            onChange={setFileTreeTabValue}
            class="h-full"
            data-scope="filetree"
          >
            <Tabs.List>
              <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                <Show
                  when={settings.general.newLayoutDesigns()}
                  fallback={
                    <>
                      {props.reviewCount()}{" "}
                      {language.t(
                        props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                      )}
                    </>
                  }
                >
                  {language.t("session.review.filesChanged", { count: props.reviewCount() })}
                </Show>
              </Tabs.Trigger>
              <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                {language.t("session.files.all")}
              </Tabs.Trigger>
            </Tabs.List>
            <Show when={fileTreeTab() === "changes"}>
              <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={props.hasReview() || !props.diffsReady()}>
                    <Show
                      when={props.diffsReady()}
                      fallback={
                        <div class="px-2 py-2 text-12-regular text-text-weak">
                          {language.t("common.loading")}
                          {language.t("common.loading.ellipsis")}
                        </div>
                      }
                    >
                      <FileTree
                        path=""
                        class="pt-3"
                        allowed={props.diffFiles()}
                        kinds={props.kinds()}
                        draggable={false}
                        active={props.activeDiff}
                        onFileClick={(node) => props.focusReviewDiff(node.path)}
                      />
                    </Show>
                  </Match>
                </Switch>
              </Tabs.Content>
            </Show>
            <Show when={fileTreeTab() === "all"}>
              <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                  <Match when={true}>
                    <FileTree
                      path=""
                      class="pt-3"
                      modified={props.diffFiles()}
                      kinds={props.kinds()}
                      onFileClick={(node) => props.onOpenTab(file.tab(node.path))}
                    />
                  </Match>
                </Switch>
              </Tabs.Content>
            </Show>
          </Tabs>
        </div>
        <Show when={props.fileOpen()}>
          <div onPointerDown={() => props.size.start()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={fileTreeWidth()}
              min={FILE_TREE_WIDTH_MIN}
              max={480}
              onResize={(width) => {
                props.size.touch()
                layout.fileTree.resize(width)
              }}
            />
          </div>
        </Show>
      </div>
    </Show>
  )
}
