import { createSimpleContext } from "@opencode-ai/ui/context"
import { useNavigate, useParams } from "@solidjs/router"
import { routeTurn, type BreniacRoute } from "@/components/breniac/route"
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

    // Resposta falada (issue #45) fica pra próxima — por ora a execução é
    // silenciosa (comando de app real, ou prompt pré-preenchido numa sessão
    // real). Auto-enviar o prompt sem revisão do usuário fica de fora
    // deliberadamente por ora: uma transcrição errada não deve disparar
    // trabalho de agente sem checkpoint humano.
    const execute = (route: BreniacRoute) => {
      if (route.kind === "appCommand") {
        command.trigger(route.commandID)
        return
      }

      const directory = decode64(params.dir)
      if (!directory) {
        showToast({
          title: language.t("breniac.toast.noProject.title"),
          description: language.t("breniac.toast.noProject.description"),
        })
        return
      }

      navigate(`/${params.dir}/session?prompt=${encodeURIComponent(route.prompt)}`)
    }

    const capture = createVoiceCapture((audio) => {
      transcribeTurn(serverSDK, audio)
        .then((text) => routeTurn(serverSDK, text, command.options))
        .then(execute)
        .catch((error) => console.error("[breniac] falha ao processar turno", error))
    })

    const toggle = async () => {
      if (capture.state() === "idle") {
        await capture.start()
        return
      }
      capture.stop()
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
    }
  },
})

export type { VoiceCaptureState }
