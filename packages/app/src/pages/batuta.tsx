import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"

// Full activity list/creation UI lands in a follow-up slice; this page currently
// only establishes the route + intro so the sidebar entry has somewhere to go.
export function BatutaPage() {
  const language = useLanguage()

  return (
    <div
      class={`
        m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView class="h-full">
        <div class="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-3 py-8 lg:px-6">
          <div class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-v2-background-bg-raised text-v2-icon-icon-base">
              <IconV2 name="batuta" size="large" />
            </div>
            <h1 class="text-lg font-medium text-v2-text-text-base">{language.t("batuta.title")}</h1>
          </div>
          <p class="text-sm leading-relaxed text-v2-text-text-muted">{language.t("batuta.intro")}</p>
        </div>
      </ScrollView>
    </div>
  )
}
