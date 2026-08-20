import { createSimpleContext } from "@opencode-ai/ui/context"
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

    // O roteamento (comando de app vs. prompt de sessão) e a execução real
    // chegam nas próximas issues do epic (#43-45) — por ora transcrevemos o
    // turno e apenas logamos o texto reconhecido.
    const capture = createVoiceCapture((audio) => {
      transcribeTurn(serverSDK, audio)
        .then((text) => console.log("[breniac] turno transcrito:", text))
        .catch((error) => console.error("[breniac] falha ao transcrever turno", error))
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
