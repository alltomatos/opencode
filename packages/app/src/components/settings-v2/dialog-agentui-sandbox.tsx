import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

type SandboxMessage = { role: "user" | "agent"; text: string; blocked?: boolean }

// In-app test chat for an AgentUI agent — runs messages through the exact
// same pipeline (guardrails, hardened personality, RAG, resolved model) a
// real channel would, against a dedicated sandbox session, so an agent can
// be tried out before it's wired to Telegram (or anything else).
export const DialogAgentUISandbox: Component<{
  agentID: string
  agentName: string
  directory?: string
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [messages, setMessages] = createSignal<SandboxMessage[]>([])
  const [draft, setDraft] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const send = async () => {
    const text = draft().trim()
    if (!text || sending()) return
    if (!props.directory) {
      showToast({ title: language.t("settings.agentui.sandbox.noDirectory") })
      return
    }
    setDraft("")
    setMessages((list) => [...list, { role: "user", text }])
    setSending(true)
    try {
      const result = await serverSDK().client.agentui.test({
        id: props.agentID,
        projectDirectory: props.directory,
        message: text,
      })
      const data = result.data
      setMessages((list) => [...list, { role: "agent", text: data?.reply ?? "(sem resposta)", blocked: data?.blocked }])
    } catch (cause) {
      setMessages((list) => [
        ...list,
        { role: "agent", text: cause instanceof Error ? cause.message : String(cause), blocked: true },
      ])
    } finally {
      setSending(false)
    }
  }

  const reset = async () => {
    try {
      await serverSDK().client.agentui.resetSandbox({ id: props.agentID })
    } catch {
      // Best-effort — the local transcript clears either way, and the next
      // message just creates a fresh sandbox session server-side too.
    }
    setMessages([])
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader>
        <DialogTitle>{language.t("settings.agentui.sandbox.title", { name: props.agentName })}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-3 px-4 pt-4 pb-2">
        <ScrollView class="h-[320px] min-h-0 w-full rounded-md border border-v2-border-border-base">
          <div class="flex flex-col gap-2 p-3">
            <Show
              when={messages().length > 0}
              fallback={<p class="text-13-regular text-v2-text-text-faint">{language.t("settings.agentui.sandbox.empty")}</p>}
            >
              <For each={messages()}>
                {(message) => (
                  <div
                    class="max-w-[85%] rounded-md px-3 py-2 text-13-regular"
                    classList={{
                      "self-end bg-v2-background-bg-brand text-v2-text-text-on-brand": message.role === "user",
                      "self-start bg-v2-background-bg-layer-01 text-v2-text-text-base": message.role === "agent" && !message.blocked,
                      "self-start bg-v2-state-bg-danger text-v2-state-fg-danger": message.blocked === true,
                    }}
                  >
                    {message.text}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </ScrollView>
        <div class="flex items-center gap-2">
          <TextInputV2
            class="flex-1"
            value={draft()}
            placeholder={language.t("settings.agentui.sandbox.placeholder")}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <ButtonV2 variant="contrast" disabled={sending()} onClick={() => void send()}>
            {language.t("settings.agentui.sandbox.send")}
          </ButtonV2>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => void reset()}>
          {language.t("settings.agentui.sandbox.reset")}
        </ButtonV2>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
