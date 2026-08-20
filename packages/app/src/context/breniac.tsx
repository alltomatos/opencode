import { createSimpleContext } from "@opencode-ai/ui/context"
import { useNavigate, useParams } from "@solidjs/router"
import { createResource } from "solid-js"
import { appendTurn } from "@/components/breniac/append-turn"
import { loadMemoryContext } from "@/components/breniac/load-memory"
import { routeTurn, type BreniacRoute } from "@/components/breniac/route"
import { speakText } from "@/components/breniac/speak"
import { promoteSummaryToGlobal, summarizeVoiceSession } from "@/components/breniac/summarize"
import { transcribeTurn } from "@/components/breniac/transcribe"
import { createVoiceCapture, type VoiceCaptureState } from "@/components/breniac/use-voice-capture"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { decode64 } from "@/utils/base64"
import { showToast } from "@/utils/toast"

export const { use: useBreniac, provider: BreniacProvider } = createSimpleContext({
  name: "Breniac",
  gate: false,
  init: () => {
    const command = useCommand()
    const language = useLanguage()
    const serverSDK = useServerSDK()
    const navigate = useNavigate()
    const params = useParams<{ dir?: string }>()

    const [enabledResource, { refetch: refreshEnabled }] = createResource(async () => {
      const result = await serverSDK().client.breniac.getConfig()
      return result.data?.enabled ?? false
    })

    // Auto-enviar o prompt de sessão sem revisão do usuário fica de fora
    // deliberadamente por ora: uma transcrição errada não deve disparar
    // trabalho de agente sem checkpoint humano — a resposta falada aqui
    // confirma a ação tomada, não o resultado de um trabalho de sessão
    // ainda não executado.
    const execute = (route: BreniacRoute): string => {
      if (route.kind === "appCommand") {
        const title = command.options.find((option) => option.id === route.commandID)?.title ?? route.commandID
        command.trigger(route.commandID)
        return language.t("breniac.speak.commandDone", { title })
      }

      const directory = decode64(params.dir)
      if (!directory) {
        showToast({
          title: language.t("breniac.toast.noProject.title"),
          description: language.t("breniac.toast.noProject.description"),
        })
        return language.t("breniac.speak.noProject")
      }

      navigate(`/${params.dir}/session?prompt=${encodeURIComponent(route.prompt)}`)
      return language.t("breniac.speak.promptReady")
    }

    let voiceSessionID: string | undefined
    let memoryContext = ""

    const capture = createVoiceCapture((audio) => {
      const sessionID = voiceSessionID
      let transcript = ""
      transcribeTurn(serverSDK, audio)
        .then((text) => {
          transcript = text
          return routeTurn(serverSDK, text, command.options, memoryContext || undefined)
        })
        .then(execute)
        .then(async (confirmation) => {
          await speakText(serverSDK, confirmation)
          if (sessionID) await appendTurn(serverSDK, sessionID, transcript, confirmation)
        })
        .catch((error) => console.error("[breniac] falha ao processar turno", error))
    })

    const toggle = async () => {
      if (capture.state() === "idle") {
        voiceSessionID = crypto.randomUUID()
        memoryContext = await loadMemoryContext(serverSDK, decode64(params.dir))
        await capture.start()
        return
      }

      const sessionID = voiceSessionID
      voiceSessionID = undefined
      capture.stop()

      const directory = decode64(params.dir)
      if (!sessionID || !directory) return

      summarizeVoiceSession(serverSDK, sessionID, directory)
        .then(async (result) => {
          if (!result.summarized || !result.summary) return
          // RF-16: memória global nunca é escrita silenciosamente — só promove
          // com confirmação explícita do usuário.
          if (result.suggestsGlobal && window.confirm(language.t("breniac.memory.confirmGlobal", { reason: result.globalReason ?? "" }))) {
            await promoteSummaryToGlobal(serverSDK, result.summary)
          }
        })
        .catch((error) => console.error("[breniac] falha ao resumir a sessão de voz", error))
    }

    command.register("breniac", () => [
      {
        id: "breniac.toggle",
        title: capture.state() === "idle" ? language.t("breniac.command.turnOn") : language.t("breniac.command.turnOff"),
        category: language.t("command.category.settings"),
        keybind: "mod+shift+b",
        onSelect: () => void toggle(),
      },
    ])

    return {
      state: capture.state,
      on: () => capture.state() !== "idle",
      toggle,
      enabled: () => enabledResource() ?? false,
      refreshEnabled: () => void refreshEnabled(),
    }
  },
})

export type { VoiceCaptureState }
