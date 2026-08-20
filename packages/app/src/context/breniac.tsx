import { createSimpleContext } from "@opencode-ai/ui/context"
import { createVoiceCapture, type VoiceCaptureState } from "@/components/breniac/use-voice-capture"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export const { use: useBreniac, provider: BreniacProvider } = createSimpleContext({
  name: "Breniac",
  gate: false,
  init: () => {
    const command = useCommand()
    const language = useLanguage()

    // O tratamento de verdade de um turno (transcrição, roteamento, execução,
    // resposta em áudio) chega nas próximas issues do epic (#42-45) — por ora
    // só capturamos o áudio do turno.
    const capture = createVoiceCapture((_audio) => {})

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
