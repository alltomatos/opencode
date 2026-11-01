import { createSignal, createResource, For, Show, type Component } from "solid-js"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { getRelativeTime } from "@/utils/time"

export interface DialogImportSessionProps {
  directory?: string
  projectName?: string
  onImportComplete?: () => void
}

export const DialogImportSession: Component<DialogImportSessionProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  const [filterThisProject, setFilterThisProject] = createSignal(true)
  const [selectedDbPath, setSelectedDbPath] = createSignal<string>("")
  const [selectedSessionIDs, setSelectedSessionIDs] = createSignal<Set<string>>(new Set())
  const [importing, setImporting] = createSignal(false)

  // 1. Carrega instalações detectadas
  const [installations] = createResource(async () => {
    if (!platform.detectLegacyInstallations) return []
    const found = await platform.detectLegacyInstallations()
    if (found.length > 0 && !selectedDbPath()) {
      setSelectedDbPath(found[0]!.dbPath)
    }
    return found
  })

  // 2. Carrega sessões da fonte selecionada
  const [sessions, { refetch: refetchSessions }] = createResource(
    () => ({
      dbPath: selectedDbPath(),
      filter: filterThisProject() ? props.directory : undefined,
    }),
    async (source) => {
      if (!source.dbPath || !platform.listLegacySessions) return []
      const list = await platform.listLegacySessions(source.dbPath, source.filter)
      // Seleciona todas inicialmente
      setSelectedSessionIDs(new Set(list.map((s) => s.id)))
      return list
    },
  )

  const toggleSession = (id: string) => {
    setSelectedSessionIDs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    const list = sessions() ?? []
    if (selectedSessionIDs().size === list.length) {
      setSelectedSessionIDs(new Set<string>())
    } else {
      setSelectedSessionIDs(new Set(list.map((s) => s.id)))
    }
  }

  const chooseCustomFile = async () => {
    if (!platform.openAttachmentPickerDialog) return
    await platform.openAttachmentPickerDialog(
      {
        title: language.t("project.import.source.customFile"),
        extensions: ["db", "sqlite"],
        multiple: false,
      },
      async (file) => {
        const fullPath = platform.getPathForFile?.(file) ?? (file as any).path
        if (fullPath) {
          setSelectedDbPath(fullPath)
          void refetchSessions()
        }
      },
    )
  }

  const runImport = async () => {
    const dbPath = selectedDbPath()
    const targetDir = props.directory
    const ids = Array.from(selectedSessionIDs())

    if (!dbPath || !targetDir || ids.length === 0 || !platform.importLegacySessions) return

    setImporting(true)
    try {
      const res = await platform.importLegacySessions(dbPath, ids, targetDir)
      showToast({
        variant: "success",
        title: language.t("project.import.success", { count: res.migratedSessions }),
      })
      dialog.close()
      props.onImportComplete?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast({
        title: language.t("common.requestFailed"),
        description: msg,
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog size="large" fit>
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("project.import.title")}</DialogTitle>
      </DialogHeader>

      <DialogBody class="flex max-h-[min(560px,calc(100vh-160px))] w-full flex-col gap-4 overflow-y-auto px-4 pt-3 pb-2">
        <p class="text-12-regular text-v2-text-text-muted">
          {language.t("project.import.description")}
        </p>

        {/* Escolha da Origem da Instalação */}
        <div class="flex flex-col gap-1.5">
          <label class="text-11-medium text-v2-text-text-base">
            {language.t("project.import.source.label")}
          </label>
          <div class="flex items-center gap-2">
            <select
              class={`
                h-9 flex-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-2.5 text-13-regular
                text-v2-text-text-base shadow-xs transition-colors focus:border-v2-state-border-focused focus:outline-hidden
              `}
              value={selectedDbPath()}
              onChange={(e) => {
                setSelectedDbPath(e.currentTarget.value)
                void refetchSessions()
              }}
            >
              <For each={installations() ?? []}>
                {(inst) => (
                  <option value={inst.dbPath}>
                    {inst.name} ({inst.sessionCount} sessões)
                  </option>
                )}
              </For>
            </select>
            <ButtonV2 variant="outline" size="normal" onClick={chooseCustomFile}>
              {language.t("project.import.source.customFile")}
            </ButtonV2>
          </div>
          <Show when={selectedDbPath()}>
            <span class="text-11-regular font-mono text-v2-text-text-faint truncate">
              {selectedDbPath()}
            </span>
          </Show>
        </div>

        {/* Filtro do Projeto */}
        <Show when={props.directory}>
          <div class="flex items-center gap-2 pt-1">
            <CheckboxV2
              checked={filterThisProject()}
              onChange={(val) => {
                setFilterThisProject(val)
                void refetchSessions()
              }}
              label={
                <span class="text-12-regular text-v2-text-text-base cursor-pointer select-none">
                  {language.t("project.import.filterProject")}
                  <Show when={props.projectName}>
                    {" ("}
                    <strong class="font-medium">{props.projectName}</strong>
                    {")"}
                  </Show>
                </span>
              }
            />
          </div>
        </Show>

        {/* Lista de Sessões Encontradas */}
        <div class="flex flex-col gap-2 pt-2">
          <div class="flex items-center justify-between text-11-medium text-v2-text-text-muted">
            <span>
              {language.t("project.import.sessions.found", { count: sessions()?.length ?? 0 })}
              {" • "}
              {language.t("project.import.sessions.selectCount", { count: selectedSessionIDs().size })}
            </span>
            <Show when={(sessions()?.length ?? 0) > 0}>
              <button
                type="button"
                class="hover:underline text-v2-text-text-accent"
                onClick={toggleAll}
              >
                {selectedSessionIDs().size === (sessions()?.length ?? 0)
                  ? language.t("project.import.deselectAll")
                  : language.t("project.import.selectAll")}
              </button>
            </Show>
          </div>

          <div class="flex max-h-60 flex-col overflow-y-auto rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1">
            <Show
              when={!sessions.loading}
              fallback={
                <div class="flex items-center justify-center p-6 text-v2-text-text-muted">
                  <Spinner />
                </div>
              }
            >
              <Show
                when={(sessions()?.length ?? 0) > 0}
                fallback={
                  <div class="p-6 text-center text-12-regular text-v2-text-text-muted">
                    {language.t("project.import.sessions.empty")}
                  </div>
                }
              >
                <For each={sessions()}>
                  {(s) => {
                    const isChecked = () => selectedSessionIDs().has(s.id)
                    return (
                      <div
                        class={`
                          flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 transition-colors
                          hover:bg-v2-background-bg-layer-02
                        `}
                        onClick={() => toggleSession(s.id)}
                      >
                        <div class="flex min-w-0 flex-1 items-center gap-2.5">
                          <CheckboxV2
                            checked={isChecked()}
                            onChange={() => toggleSession(s.id)}
                            label=""
                            hideLabel
                          />
                          <div class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate text-12-medium text-v2-text-text-base">
                              {s.title}
                            </span>
                            <span class="truncate text-10-regular text-v2-text-text-faint font-mono">
                              {s.directory}
                            </span>
                          </div>
                        </div>
                        <div class="flex shrink-0 items-center gap-2 text-11-regular text-v2-text-text-muted">
                          <span class="rounded bg-v2-background-bg-layer-03 px-1.5 py-0.5 text-10-medium">
                            {language.t("project.import.sessions.messages", { count: s.messageCount })}
                          </span>
                          <span>{getRelativeTime(new Date(s.timeUpdated).toISOString(), language.t)}</span>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <ButtonV2 variant="outline" size="normal" onClick={() => dialog.close()} disabled={importing()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="contrast"
          size="normal"
          onClick={runImport}
          disabled={selectedSessionIDs().size === 0 || importing() || !props.directory}
          loading={importing()}
        >
          {importing()
            ? language.t("project.import.importing")
            : language.t("project.import.action")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
