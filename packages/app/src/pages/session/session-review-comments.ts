import { createMemo } from "solid-js"
import { selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import type { useFile } from "@/context/file"
import type { useComments } from "@/context/comments"
import type { usePrompt } from "@/context/prompt"
import type { useLanguage } from "@/context/language"

/**
 * Owns turning a review line-comment (add/edit/remove) into both the
 * comments store entry and the matching prompt-context item — the two
 * always change together, so this is the single place that keeps them in
 * sync.
 */
export function createReviewComments(deps: {
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  prompt: ReturnType<typeof usePrompt>
  language: ReturnType<typeof useLanguage>
}) {
  const { file, comments, prompt, language } = deps

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  return { selectionPreview, addCommentToContext, updateCommentInContext, removeCommentFromContext, reviewCommentActions }
}
