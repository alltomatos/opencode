import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { sessionHref } from "@/utils/session-route"
import { detectGpuSupport } from "@/utils/gpu"
import { showToast } from "@/utils/toast"
import { BatutaActivityPanel2D } from "@/components/batuta/activity-panel-2d"
import { ArchitectIcon } from "@/components/batuta/role-icons"
import { PipelineVerticalList, PipelineKanban } from "@/components/batuta/pipeline-timeline"
import type { BatutaActivity } from "@opencode-ai/sdk/v2"
import type { BatutaPanelNode } from "@/components/batuta/use-activity-nodes"

const SYNC_INTERVAL_MS = 2000

// Dynamic imports can transiently fail (dev server mid-recompile, a flaky
// connection, a stale chunk hash right after a deploy) — retry a couple
// times with a short backoff before giving up and surfacing the error.
async function importWithRetry<T>(load: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await load()
    } catch (error) {
      if (attempt === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
  throw new Error("unreachable")
}

// three.js is a heavy dependency (~600KB) only needed when the 3D panel
// actually renders (GPU-capable + opted into 3D animations) — code-split it
// out of the main bundle instead of shipping it unconditionally.
const BatutaActivityPanel3D = lazy(() =>
  importWithRetry(() =>
    import("@/components/batuta/activity-panel-3d").then((m) => ({ default: m.BatutaActivityPanel3D })),
  ),
)

function useLiveFile(props: { directory: () => string | undefined; relativePath: string }) {
  const serverSDK = useServerSDK()
  const [content, setContent] = createSignal<string>()

  const poll = async () => {
    const directory = props.directory()
    if (!directory) return
    try {
      const result = await serverSDK().client.file.read({ path: props.relativePath, directory })
      setContent(result.data?.type === "text" ? result.data.content : undefined)
    } catch {
      setContent(undefined)
    }
  }

  createEffect(() => {
    void poll()
    const timer = setInterval(() => void poll(), SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return content
}

function usePipelineText(directory: () => string | undefined) {
  const params = useParams<{ id: string }>()
  return useLiveFile({ directory, relativePath: `.batuta/${params.id}/pipeline.md` })
}

// docs/batuta-pipeline.md is per-project (not per-activity), so it goes
// through Batuta's own read endpoint rather than the generic file.read used
// for the activity-scoped handoff/pipeline files.
function usePipelineDefinitionText(props: { id: string; directory: () => string | undefined }) {
  const serverSDK = useServerSDK()
  const [content, setContent] = createSignal<string>()

  const poll = async () => {
    try {
      const result = await serverSDK().client.batuta.getPipelineDefinition({
        id: props.id,
        directory: props.directory(),
      })
      setContent(result.data?.content)
    } catch {
      setContent(undefined)
    }
  }

  createEffect(() => {
    void poll()
    const timer = setInterval(() => void poll(), SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return content
}

// The pipeline chat is a real session under the hood (parentID-linked, so it
// never shows in the normal session list) restricted by permission ruleset to
// only touch docs/batuta-pipeline.md — see Batuta.Service.startPipelineChat.
function PipelineChatPanel(props: { activity: BatutaActivity; onFileChanged: () => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [sessionID, setSessionID] = createSignal<string>()
  const [starting, setStarting] = createSignal(false)
  const [lines, setLines] = createSignal<{ role: string; text: string }[]>([])
  const [input, setInput] = createSignal("")

  const ensureSession = async () => {
    if (sessionID() || starting()) return
    setStarting(true)
    try {
      const result = await serverSDK().client.batuta.startPipelineChat({
        id: props.activity.id,
        directory: props.activity.directory,
      })
      if (result.data?.sessionID) setSessionID(result.data.sessionID)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStarting(false)
    }
  }

  const poll = async () => {
    const id = sessionID()
    if (!id) return
    try {
      const result = await serverSDK().client.session.messages({ sessionID: id })
      const messages = result.data ?? []
      const next: { role: string; text: string }[] = []
      for (const message of messages) {
        const role = message.info?.role ?? "assistant"
        for (const part of message.parts ?? []) {
          if (part.type === "text" && part.text.trim()) next.push({ role, text: part.text.trim() })
        }
      }
      setLines(next)
    } catch {
      // keep last known lines
    }
  }

  onMount(() => {
    void ensureSession()
  })

  createEffect(() => {
    if (!sessionID()) return
    void poll()
    const timer = setInterval(() => void poll(), SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const sendMutation = useMutation(() => ({
    mutationFn: async () => {
      const id = sessionID()
      if (!id) throw new Error("Chat session not ready")
      const text = input().trim()
      if (!text) return
      setInput("")
      await serverSDK().client.session.prompt({
        sessionID: id,
        directory: props.activity.directory,
        parts: [{ type: "text", text }],
      })
    },
    onSuccess: async () => {
      await poll()
      props.onFileChanged()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  return (
    <div class="flex flex-col gap-2">
      <p class="text-12-regular text-v2-text-text-muted">{language.t("batuta.pipeline.chat.description")}</p>
      <div class="flex max-h-[280px] min-h-[160px] flex-col gap-2 overflow-y-auto rounded-md bg-v2-background-bg-layer-01 p-3">
        <Show when={!starting()} fallback={<span class="text-12-regular text-v2-text-text-muted">{language.t("batuta.pipeline.chat.starting")}</span>}>
          <Show
            when={lines().length}
            fallback={<span class="text-12-regular text-v2-text-text-muted">{language.t("batuta.pipeline.chat.empty")}</span>}
          >
            <For each={lines()}>
              {(line) => (
                <p class="whitespace-pre-wrap break-words text-12-regular text-v2-text-text-base">
                  <span class="text-v2-text-text-muted">{line.role === "user" ? "› " : "· "}</span>
                  {line.text}
                </p>
              )}
            </For>
          </Show>
        </Show>
      </div>
      <div class="flex items-end gap-2">
        <TextareaV2
          class="!w-full flex-1"
          rows={2}
          placeholder={language.t("batuta.pipeline.chat.placeholder")}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              sendMutation.mutate()
            }
          }}
        />
        <ButtonV2
          variant="contrast"
          disabled={sendMutation.isPending || starting() || !sessionID()}
          onClick={() => sendMutation.mutate()}
        >
          {language.t("batuta.pipeline.chat.send")}
        </ButtonV2>
      </div>
    </div>
  )
}

function PipelineDefinitionEditorBody(props: { activity: BatutaActivity; onSaved: (content: string) => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [value, setValue] = createSignal("")

  const loadValue = async () => {
    const result = await serverSDK().client.batuta.getPipelineDefinition({
      id: props.activity.id,
      directory: props.activity.directory,
    })
    setValue(result.data?.content ?? "")
  }

  createEffect(() => {
    void loadValue()
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      await serverSDK().client.batuta.setPipelineDefinition({
        id: props.activity.id,
        directory: props.activity.directory,
        content: value(),
      })
      return value()
    },
    onSuccess: (content) => props.onSaved(content),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  return (
    <>
      <DialogHeader>
        <DialogTitle>{language.t("batuta.pipeline.editor.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2 px-4 pt-2 pb-4">
        <TabsV2 defaultValue="editor" class="flex w-full flex-col gap-2">
          <TabsV2.List>
            <TabsV2.Trigger value="editor">{language.t("batuta.pipeline.editor.tab.editor")}</TabsV2.Trigger>
            <TabsV2.Trigger value="chat">{language.t("batuta.pipeline.editor.tab.chat")}</TabsV2.Trigger>
          </TabsV2.List>
          <TabsV2.Content value="editor">
            <div class="flex flex-col gap-2">
              <p class="text-12-regular text-v2-text-text-muted">{language.t("batuta.pipeline.editor.description")}</p>
              <TextareaV2
                class="!w-full self-stretch font-mono"
                rows={16}
                value={value()}
                onInput={(event) => setValue(event.currentTarget.value)}
              />
            </div>
          </TabsV2.Content>
          <TabsV2.Content value="chat">
            <PipelineChatPanel activity={props.activity} onFileChanged={() => void loadValue()} />
          </TabsV2.Content>
        </TabsV2>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="contrast" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? language.t("common.saving") : language.t("batuta.pipeline.editor.save")}
        </ButtonV2>
      </DialogFooter>
    </>
  )
}

// Polls the node's own session messages every 2s while its detail panel is
// open — gives an in-place "what is this agent doing right now" view without
// leaving the flow graph. Reuses the same polling pattern as the node graph
// itself (no WebSocket infra exists yet for this).
function NodeDetailPanel(props: { node: BatutaPanelNode; onClose: () => void; onOpenSession: () => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [lines, setLines] = createSignal<string[]>([])

  const poll = async () => {
    try {
      const result = await serverSDK().client.session.messages({ sessionID: props.node.sessionID, limit: 6 })
      const messages = result.data ?? []
      const next: string[] = []
      for (const message of messages) {
        for (const part of message.parts ?? []) {
          if (part.type === "text" && part.text.trim()) next.push(part.text.trim())
          else if (part.type === "tool") next.push(`→ ${part.tool}`)
        }
      }
      setLines(next.slice(-8))
    } catch {
      // Session may have just been created or already ended — keep the last known lines.
    }
  }

  createEffect(() => {
    props.node.sessionID
    void poll()
    const timer = setInterval(() => void poll(), SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="flex w-full max-w-[420px] flex-col gap-2 rounded-[10px] border border-v2-border-border-base p-3">
      <div class="flex items-center gap-2">
        <span class="flex-1 truncate text-12-medium text-v2-text-text-base">{props.node.label}</span>
        <ButtonV2 variant="ghost-muted" size="small" onClick={props.onOpenSession}>
          {language.t("batuta.panel.detail.open")}
        </ButtonV2>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="close" />}
          aria-label={language.t("common.close")}
          onClick={props.onClose}
        />
      </div>
      <Show
        when={lines().length}
        fallback={<span class="text-11-regular text-v2-text-text-muted">{language.t("batuta.panel.detail.empty")}</span>}
      >
        <div class="flex flex-col gap-1">
          <For each={lines()}>
            {(line) => <p class="truncate text-11-regular text-v2-text-text-muted">{line}</p>}
          </For>
        </div>
      </Show>
    </div>
  )
}

function HandoffPanel(props: { directory?: string }) {
  const params = useParams<{ id: string }>()
  const content = useLiveFile({ directory: () => props.directory, relativePath: `.batuta/${params.id}/handoff.md` })

  return (
    <Show when={content()}>
      {(text) => (
        <pre class="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-v2-background-bg-layer-01 p-3 text-12-regular text-v2-text-text-muted">
          {text()}
        </pre>
      )}
    </Show>
  )
}

export function BatutaActivityLivePage() {
  const language = useLanguage()
  const settings = useSettings()
  const server = useServer()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()

  const [activities, { refetch }] = createResource(async () => {
    const result = await serverSDK().client.batuta.list()
    return result.data ?? []
  })
  const activity = createMemo(() => activities()?.find((item) => item.id === params.id))
  const pipelineText = usePipelineText(() => activity()?.directory)
  const pipelineDefinitionText = usePipelineDefinitionText({
    id: params.id,
    directory: () => activity()?.directory,
  })
  const dialog = useDialog()
  const openPipelineEditor = () => {
    const current = activity()
    if (!current) return
    dialog.show(() => (
      <Dialog>
        <PipelineDefinitionEditorBody
          activity={current}
          onSaved={() => {
            dialog.close()
            showToast({ variant: "success", icon: "circle-check", title: language.t("batuta.pipeline.editor.save") })
          }}
        />
      </Dialog>
    ))
  }

  // While the Architect is still working, poll for its handoff file — once
  // found the backend moves the activity to "ready" and stops needing sync.
  createEffect(() => {
    const current = activity()
    if (!current || current.phase !== "architecting") return
    const timer = setInterval(async () => {
      await serverSDK().client.batuta.sync({ id: current.id, directory: current.directory })
      await refetch()
    }, SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const dispatchMutation = useMutation(() => ({
    mutationFn: async () => {
      const current = activity()
      if (!current) throw new Error("Activity not loaded")
      const result = await serverSDK().client.batuta.dispatch({ id: current.id, directory: current.directory })
      return result.data
    },
    onSuccess: () => void refetch(),
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const [selectedNode, setSelectedNode] = createSignal<BatutaPanelNode>()
  const openNode = (node: BatutaPanelNode) => setSelectedNode(node)
  const openNodeSession = (node: BatutaPanelNode) => navigate(sessionHref(server.key, node.sessionID))

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3">
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="arrow-left" />}
          aria-label={language.t("common.goBack")}
          onClick={() => navigate("/batuta")}
        />
        <span class="flex-1 truncate text-13-medium text-v2-text-text-base">
          {activity()?.name ?? language.t("batuta.panel.title")}
        </span>
        <Show when={activity()}>
          <ButtonV2 variant="ghost-muted" size="small" onClick={openPipelineEditor}>
            {language.t("batuta.pipeline.editor.open")}
          </ButtonV2>
        </Show>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="close" />}
          aria-label={language.t("common.close")}
          onClick={() => navigate("/batuta")}
        />
      </div>
      <Show
        when={activity()}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-v2-text-text-muted">
            {language.t("batuta.panel.empty")}
          </div>
        }
      >
        {(current) => (
          <div class="flex min-h-0 flex-1">
            <div class="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 overflow-y-auto px-3 py-8 lg:px-6">
              <p class="text-sm leading-relaxed text-v2-text-text-muted">{current().goal}</p>

              <Show when={current().phase === "orchestrating" && current().orchestratorSessionID}>
                {(orchestratorSessionID) => (
                  <TabsV2 defaultValue="graph" class="flex w-full flex-col gap-4">
                    <TabsV2.List>
                      <TabsV2.Trigger value="graph">{language.t("batuta.panel.tab.graph")}</TabsV2.Trigger>
                      <TabsV2.Trigger value="pipeline">{language.t("batuta.panel.tab.pipeline")}</TabsV2.Trigger>
                      <TabsV2.Trigger value="kanban">{language.t("batuta.panel.tab.kanban")}</TabsV2.Trigger>
                    </TabsV2.List>
                    <TabsV2.Content value="graph">
                      <div class="flex flex-col items-center gap-4">
                        <Show
                          when={settings.general.use3dAnimations() && detectGpuSupport()}
                          fallback={
                            <BatutaActivityPanel2D
                              orchestratorSessionID={orchestratorSessionID()!}
                              activity={current()}
                              onSelectNode={openNode}
                            />
                          }
                        >
                          <Suspense
                            fallback={
                              <BatutaActivityPanel2D
                                orchestratorSessionID={orchestratorSessionID()!}
                                activity={current()}
                                onSelectNode={openNode}
                              />
                            }
                          >
                            <BatutaActivityPanel3D
                              orchestratorSessionID={orchestratorSessionID()!}
                              activity={current()}
                              onSelectNode={openNode}
                            />
                          </Suspense>
                        </Show>
                      </div>
                    </TabsV2.Content>
                    <TabsV2.Content value="pipeline">
                      <PipelineVerticalList
                        architectDone
                        orchestratorStarted
                        pipelineText={pipelineText()}
                        pipelineDefinitionText={pipelineDefinitionText()}
                      />
                    </TabsV2.Content>
                    <TabsV2.Content value="kanban">
                      <PipelineKanban architectDone orchestratorStarted pipelineText={pipelineText()} />
                    </TabsV2.Content>
                  </TabsV2>
                )}
              </Show>

              <Show when={current().phase === "ready"}>
                <div class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-base p-4">
                  <div class="flex items-center gap-2">
                    <Icon name="circle-check" class="size-4 shrink-0 text-v2-state-fg-success" />
                    <span class="text-13-medium text-v2-text-text-base">{language.t("batuta.panel.ready.title")}</span>
                  </div>
                  <HandoffPanel directory={current().directory} />
                  <ButtonV2
                    variant="contrast"
                    class="self-start"
                    disabled={dispatchMutation.isPending}
                    onClick={() => dispatchMutation.mutate()}
                  >
                    {dispatchMutation.isPending
                      ? language.t("common.saving")
                      : language.t("batuta.panel.ready.dispatch")}
                  </ButtonV2>
                </div>
              </Show>

              <Show
                when={current().phase !== "orchestrating" && current().phase !== "ready" && current().architectSessionID}
              >
                {(architectSessionID) => (
                  <div class="flex flex-col items-center gap-3 rounded-[10px] border border-v2-border-border-base p-6 text-center">
                    <ArchitectIcon class="size-12" animated />
                    <span class="text-13-medium text-v2-text-text-base">
                      {language.t("batuta.panel.architect.working")}
                    </span>
                    <ButtonV2
                      variant="neutral"
                      size="small"
                      onClick={() => navigate(sessionHref(server.key, architectSessionID()))}
                    >
                      {language.t("batuta.panel.architect.open")}
                    </ButtonV2>
                  </div>
                )}
              </Show>

              <Show when={!current().phase}>
                <div class="flex flex-1 items-center justify-center text-sm text-v2-text-text-muted">
                  {language.t("batuta.panel.empty")}
                </div>
              </Show>
            </div>

            <Show when={selectedNode()}>
              {(node) => (
                <div class="w-[300px] shrink-0 overflow-y-auto border-l border-v2-border-border-base p-3">
                  <NodeDetailPanel
                    node={node()}
                    onClose={() => setSelectedNode(undefined)}
                    onOpenSession={() => openNodeSession(node())}
                  />
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
