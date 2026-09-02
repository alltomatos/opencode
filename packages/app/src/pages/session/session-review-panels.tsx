import { createMemo, Show } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Button } from "@opencode-ai/ui/button"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { SessionReviewEmptyChangesV2 } from "@opencode-ai/session-ui/v2/session-review-empty-changes-v2"
import { SessionReviewEmptyNoGitV2 } from "@opencode-ai/session-ui/v2/session-review-empty-no-git-v2"
import { ReviewPanelV2 } from "@/pages/session/v2/review-panel-v2"
import type { createReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import type { ChangeMode, createVcsReview } from "./session-vcs-review"
import type { createReviewComments } from "./session-review-comments"
import type { createReviewDiffScroll } from "./session-review-diff-scroll"
import type { createOpenReviewFile } from "./helpers"
import type { SessionReviewLineComment } from "@opencode-ai/session-ui/session-review"
import type { useLanguage } from "@/context/language"
import type { useSettings } from "@/context/settings"
import type { useLayout } from "@/context/layout"
import type { useComments } from "@/context/comments"
import type { useFile } from "@/context/file"
import type { useSessionLayout } from "@/pages/session/session-layout"

export function createReviewPanels(input: {
  language: ReturnType<typeof useLanguage>
  settings: ReturnType<typeof useSettings>
  layout: ReturnType<typeof useLayout>
  comments: ReturnType<typeof useComments>
  file: ReturnType<typeof useFile>
  canReview: () => boolean
  reviewMode: () => "git" | "branch" | "turn"
  changesOptions: () => ChangeMode[]
  view: ReturnType<typeof useSessionLayout>["view"]
  gitMutation: { isPending: boolean; mutate: () => void }
  initGit: () => void
  reviewReady: ReturnType<typeof createVcsReview>["reviewReady"]
  nogit: ReturnType<typeof createVcsReview>["nogit"]
  deferRender: () => boolean
  reviewDiffs: ReturnType<typeof createVcsReview>["reviewDiffs"]
  activeReviewFile: ReturnType<typeof createVcsReview>["activeReviewFile"]
  addCommentToContext: ReturnType<typeof createReviewComments>["addCommentToContext"]
  updateCommentInContext: ReturnType<typeof createReviewComments>["updateCommentInContext"]
  removeCommentFromContext: ReturnType<typeof createReviewComments>["removeCommentFromContext"]
  reviewCommentActions: ReturnType<typeof createReviewComments>["reviewCommentActions"]
  openReviewFile: ReturnType<typeof createOpenReviewFile>
  vcsQuery: { dataUpdatedAt: number }
  loadReviewDiff: ReturnType<typeof createVcsReview>["loadReviewDiff"]
  focusReviewDiff: ReturnType<typeof createReviewDiffScroll>["focusReviewDiff"]
  reviewV2State: ReturnType<typeof createReviewPanelV2State>
  onScrollRef: (el: HTMLDivElement | undefined) => void
}) {
  const { language, settings, layout, comments, file } = input
  const { canReview, reviewMode, changesOptions, view, gitMutation, initGit } = input
  const { reviewReady, nogit, deferRender, reviewDiffs, activeReviewFile } = input
  const { addCommentToContext, updateCommentInContext, removeCommentFromContext, reviewCommentActions } = input
  const { openReviewFile, vcsQuery, loadReviewDiff, focusReviewDiff, reviewV2State, onScrollRef } = input

  const changesLabel = (option: ChangeMode) => {
    if (option === "git") return language.t("ui.sessionReview.title.git")
    if (option === "branch") return language.t("ui.sessionReview.title.branch")
    return language.t("ui.sessionReview.title.lastTurn")
  }

  const changesTitle = () => {
    if (!canReview()) return null
    return (
      <Select
        options={changesOptions()}
        current={reviewMode()}
        label={changesLabel}
        onSelect={(option) => option && view().review.setMode(option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const changesTitleV2 = () => {
    if (!canReview()) return null
    return (
      <SelectV2
        appearance="inline"
        options={changesOptions()}
        current={reviewMode()}
        label={changesLabel}
        placement="bottom-start"
        gutter={6}
        onSelect={(option) => option && view().review.setMode(option)}
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const createGit = (createInput: { emptyClass: string }) => (
    <div class={createInput.emptyClass}>
      <div class="flex flex-col gap-3">
        <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
        <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
          {language.t("session.review.noVcs.createGit.description")}
        </div>
      </div>
      <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
        {gitMutation.isPending
          ? language.t("session.review.noVcs.createGit.actionLoading")
          : language.t("session.review.noVcs.createGit.action")}
      </Button>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (reviewMode() === "git") return language.t("session.review.noUncommittedChanges")
    if (reviewMode() === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (reviewInput: { loadingClass: string; emptyClass: string }) => {
    if (reviewMode() === "git" || reviewMode() === "branch") {
      if (!reviewReady()) return <div class={reviewInput.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (reviewMode() === "turn") {
      if (nogit()) return createGit(reviewInput)
      return empty(reviewEmptyText())
    }

    return (
      <div class={reviewInput.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewEmptyV2 = () => {
    if ((reviewMode() === "git" || reviewMode() === "branch") && !reviewReady()) {
      return <div class="px-6 py-4 text-text-weak">{language.t("session.review.loadingChanges")}</div>
    }
    if (reviewMode() === "turn" && nogit()) {
      return <SessionReviewEmptyNoGitV2 pending={gitMutation.isPending} onInitGit={initGit} />
    }
    return <SessionReviewEmptyChangesV2 />
  }

  const reviewContent = (contentInput: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!deferRender()}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(contentInput)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={contentInput.diffStyle}
        onDiffStyleChange={contentInput.onDiffStyleChange}
        onScrollRef={onScrollRef}
        focusedFile={activeReviewFile()}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={contentInput.classes}
      />
    </Show>
  )

  const reviewPanelV2Props = () => ({
    get title() {
      return changesTitleV2()
    },
    get empty() {
      return reviewEmptyV2()
    },
    diffs: reviewDiffs,
    diffsReady: reviewReady,
    get diffVersion() {
      return vcsQuery.dataUpdatedAt
    },
    loadDiff: loadReviewDiff,
    get activeFile() {
      return activeReviewFile()
    },
    onSelectFile: focusReviewDiff,
    get diffStyle() {
      return layout.review.diffStyle()
    },
    onDiffStyleChange: layout.review.setDiffStyle,
    state: reviewV2State,
    onLineComment: (comment: SessionReviewLineComment) => addCommentToContext({ ...comment, origin: "review" }),
    onLineCommentUpdate: updateCommentInContext,
    onLineCommentDelete: removeCommentFromContext,
    get lineCommentActions() {
      return reviewCommentActions()
    },
    get comments() {
      return comments.all()
    },
    get focusedComment() {
      return comments.focus()
    },
    onFocusedCommentChange: (focus: { file: string; id: string } | null) => {
      if (!focus) {
        const current = comments.focus()
        if (current && reviewDiffs().some((diff) => diff.file === current.file)) focusReviewDiff(current.file)
      }
      comments.setFocus(focus)
    },
  })

  const reviewPanelV2Rendered = createMemo<boolean>((prev) => prev || !deferRender(), false)

  const reviewPanelV2 = () => (
    <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
      <Show when={reviewPanelV2Rendered()}>
        <ReviewPanelV2 {...reviewPanelV2Props()} />
      </Show>
    </div>
  )

  const reviewPanel = () => (
    <div
      classList={{
        "flex flex-col h-full overflow-hidden contain-strict": true,
        "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
        "bg-background-stronger": !settings.general.newLayoutDesigns(),
      }}
    >
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  return { reviewContent, reviewPanel, reviewPanelV2, reviewEmptyText }
}
