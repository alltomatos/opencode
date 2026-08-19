import { createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { sessionTitle } from "@/utils/session-title"

export function DialogDeleteSession(props: { sessionID: string; onDelete: (sessionID: string) => Promise<unknown> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()
  const sync = useServerSync()
  const name = createMemo(
    () => sessionTitle(sync().session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
  )
  const handleDelete = async () => {
    await props.onDelete(props.sessionID)
    dialog.close()
  }

  if (settings.general.newLayoutDesigns())
    return (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 variant="danger" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    )

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("session.delete.confirm", { name: name() })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
