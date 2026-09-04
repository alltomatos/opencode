import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"

// Shown when closing a project that has recorded memory (see
// Memory.Service.hasProjectMemory) — closing itself is reversible (the
// project just moves to "recently closed"), but forgetting memory is not,
// so this is a separate, explicit choice rather than something bundled
// silently into the close action. See issue #141.
export const DialogForgetProjectMemory: Component<{
  onChoice: (forget: boolean) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const choose = (forget: boolean) => {
    dialog.close()
    props.onChoice(forget)
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("project.forgetMemory.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-col px-4 pt-4 pb-2">
        <p class="text-sm text-v2-text-text-faint">{language.t("project.forgetMemory.description")}</p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => choose(false)}>
          {language.t("project.forgetMemory.keep")}
        </ButtonV2>
        <ButtonV2 variant="danger" onClick={() => choose(true)}>
          {language.t("project.forgetMemory.forget")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
