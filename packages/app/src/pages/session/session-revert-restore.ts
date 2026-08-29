import { batch, createMemo } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import type { useSDK } from "@/context/sdk"
import type { useSync } from "@/context/sync"
import type { usePrompt, Prompt } from "@/context/prompt"

async function runPromptRollbackMutation<T, R>(input: {
  capturePrompt: () => { current: () => T[]; set: (value: T[]) => void; reset: () => void }
  optimistic: (prompt: { set: (value: T[]) => void; reset: () => void }) => void
  request: () => Promise<R>
  complete: (result: R) => void
  rollback: () => void
  fail: (error: unknown) => void
}) {
  const prompt = input.capturePrompt()
  const previous = prompt.current().slice()
  batch(() => input.optimistic(prompt))
  await input
    .request()
    .then(input.complete)
    .catch((error) => {
      batch(() => {
        input.rollback()
        prompt.set(previous)
      })
      input.fail(error)
    })
}

type SessionInfo = ReturnType<ReturnType<typeof useSync>>["session"]["get"] extends (
  id: string,
) => infer R
  ? R
  : never

/**
 * Owns reverting to (and restoring from) an earlier point in the session —
 * the optimistic-rollback mutation pair, plus the "which messages are
 * currently rolled back" derived state. Extracted as its own concern
 * because it's a self-contained request/rollback flow that doesn't touch
 * layout, review, or scroll state.
 */
export function createRevertRestore(deps: {
  sessionID: () => string | undefined
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  prompt: ReturnType<typeof usePrompt>
  userMessages: () => UserMessage[]
  revertMessageID: () => string | undefined
  draft: (id: string) => Prompt
  line: (id: string) => string
  fail: (err: unknown) => void
}) {
  const { sessionID, sync, sdk, prompt, userMessages, revertMessageID, draft, line, fail } = deps

  const busy = (id: string) => sync().data.session_working(id)

  const roll = (id: string, next: NonNullable<SessionInfo>["revert"], target = sync()) => {
    const session = target.session.get(id)
    if (!session) return
    target.session.remember({ ...session, revert: next })
  }

  const halt = (id: string) =>
    busy(id)
      ? sdk()
          .api.session.interrupt({ sessionID: id })
          .catch(() => {})
      : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const session = sdk().api.session
      const target = sync()
      const last = target.session.get(input.sessionID)?.revert
      const value = draft(input.messageID)
      await runPromptRollbackMutation({
        capturePrompt: prompt.capture,
        optimistic: (p) => {
          roll(input.sessionID, { messageID: input.messageID }, target)
          p.set(value)
        },
        request: () => halt(input.sessionID).then(() => session.revert.stage(input)),
        complete: () => undefined,
        rollback: () => roll(input.sessionID, last, target),
        fail,
      })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const id_ = sessionID()
      if (!id_) return

      const session = sdk().api.session
      const target = sync()
      const index = userMessages().findIndex((item) => item.id === id)
      if (index < 0) return
      const next = userMessages()[index + 1]
      const last = target.session.get(id_)?.revert

      await runPromptRollbackMutation({
        capturePrompt: prompt.capture,
        optimistic: (promptSession) => {
          roll(id_, next ? { messageID: next.id } : undefined, target)
          if (next) {
            promptSession.set(draft(next.id))
            return
          }
          promptSession.reset()
        },
        request: () =>
          !next
            ? halt(id_).then(() => session.revert.clear({ sessionID: id_ }))
            : halt(id_).then(() => session.revert.stage({ sessionID: id_, messageID: next.id }).then(() => undefined)),
        complete: () => undefined,
        rollback: () => roll(id_, last, target),
        fail,
      })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!sessionID() || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    const index = userMessages().findIndex((item) => item.id === id)
    if (index < 0) return []
    return userMessages()
      .slice(index)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  return { revertMutation, restoreMutation, reverting, restoring, revert, restore, rolled }
}
