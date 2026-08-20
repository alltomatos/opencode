import { createSimpleContext } from "@opencode-ai/ui/context"
import { routeTurn } from "@/components/breniac/route"
import { transcribeTurn } from "@/components/breniac/transcribe"
import { createVoiceCapture, type VoiceCaptureState } from "@/components/breniac/use-voice-capture"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"

export const { use: useBreniac, provider: BreniacProvider } = createSimpleContext({
  name: "Breniac",
  gate: false,
  init: () => {
    const command = useCommand()
    const language = useLanguage()
    const serverSDK = useServerSDK()

    // A execução real de comandos de app e a resposta falada chegam nas
    // próximas issues do epic (#44/#45) — por ora transcrevemos o turno,
    // roteamos, e apenas logamos a decisão.
    const capture = createVoiceCapture((audio) => {
      transcribeTurn(serverSDK, audio)
        .then((text) => routeTurn(serverSDK, text, command.options))
        .then((route) => console.log("[breniac] turno roteado:", route))
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
