import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { createResource, createSignal } from "solid-js"
import { appendTurn } from "@/components/breniac/append-turn"
import { loadMemoryContext } from "@/components/breniac/load-memory"
import { routeTurn, type BreniacRoute } from "@/components/breniac/route"
import { speakText } from "@/components/breniac/speak"
import { getLastAssistantMessage } from "@/components/breniac/session-context"
import { listRecentSessions } from "@/components/breniac/list-sessions"
import { promoteSummaryToGlobal, summarizeVoiceSession } from "@/components/breniac/summarize"
import { transcribeTurn } from "@/components/breniac/transcribe"
import { createVoiceCapture, type VoiceCaptureState } from "@/components/breniac/use-voice-capture"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { screenFocus } from "@/context/screen-focus"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { displayName } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"

export const { use: useBreniac, provider: BreniacProvider } = createSimpleContext({
  name: "Breniac",
  gate: false,
  init: () => {
    const command = useCommand()
    const language = useLanguage()
    const serverSDK = useServerSDK()
    const navigate = useNavigate()
    const layout = useLayout()
    const serverSync = useServerSync()
    const tabs = useTabs()
    const server = useServer()

    // useParams() só cobre a rota /:dir/session/:id — o app tem outros estados
    // ativos que não passam por ela (uma aba de rascunho/"nova sessão" usa
    // /new-session?draftId=, sessões antigas usam /server/:key/session/:id) e
    // ficavam invisíveis pro Breniac. layout.route() já normaliza os três
    // formatos (mesma lógica que dialog-settings-v2.tsx usa pra achar o
    // diretório atual) — usa isso como fonte única de verdade.
    const currentDirectory = (): string | undefined => {
      const route = layout.route()
      if (route.type === "dir-new-sesssion") return route.dir
      if (route.type === "draft") {
        const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        return draft?.type === "draft" ? draft.directory : undefined
      }
      if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
      return undefined
    }

    // A rota não muda quando um diálogo (ex.: Configurações) abre por cima da
    // tela — sem screenFocus o Breniac ficaria cego pra isso. screenFocus tem
    // prioridade quando setado.
    const routeScreen = () => {
      const directory = currentDirectory()
      if (!directory) return "Tela inicial (lista de projetos), nenhum projeto aberto."
      const project = layout.projects.list().find((item) => item.worktree === directory)
      const name = project ? displayName(project) : directory
      const serverLabel = server.isLocal() ? "servidor local" : "servidor remoto"
      const sessionState =
        layout.route().type === "session" ? "com uma sessão de código ativa" : "sem sessão ativa (tela de nova sessão)"
      return `Projeto "${name}" aberto (${serverLabel}), ${sessionState}.`
    }
    const currentScreen = () => {
      const focus = screenFocus.label()
      return focus ? `${focus} (por cima de: ${routeScreen()})` : routeScreen()
    }

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

      if (route.kind === "answer") return route.answer

      const directory = currentDirectory()
      if (!directory) {
        showToast({
          title: language.t("breniac.toast.noProject.title"),
          description: language.t("breniac.toast.noProject.description"),
        })
        return language.t("breniac.speak.noProject")
      }

      // Se já tem sessão aberta, dita a resposta direto nela (o usuário revisa e
      // envia); senão, abre o fluxo de nova sessão com o prompt pré-preenchido.
      const layoutRoute = layout.route()
      const dirBase64 = base64Encode(directory)
      const sessionPath =
        layoutRoute.type === "session" ? `/${dirBase64}/session/${layoutRoute.sessionId}` : `/${dirBase64}/session`
      navigate(`${sessionPath}?prompt=${encodeURIComponent(route.prompt)}`)
      return language.t("breniac.speak.promptReady")
    }

    // Whisper "alucina" texto quando recebe áudio sem fala real (silêncio,
    // ruído de fundo) — um punhado de frases conhecidas e bem documentadas
    // (a maioria falsos "obrigado por assistir" em vários idiomas) aparecem
    // repetidamente nessa situação. Se o mic continua ligado sem ninguém
    // falando (ex.: o toggle-off falhou em executar), esses turnos de lixo
    // não devem virar resposta nem entrar na memória.
    const WHISPER_HALLUCINATION_PATTERNS = [
      /谢谢观看/,
      /字幕by/i,
      /thanks for watching/i,
      /thank you for watching/i,
      /subscribe to my channel/i,
      /like and subscribe/i,
      /\[blank_audio\]/i,
      /\(silence\)/i,
    ]
    const isLikelyHallucination = (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return true
      return WHISPER_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(trimmed))
    }

    let voiceSessionID: string | undefined
    let memoryContext = ""
    // A captura continua gravando durante a fala do Breniac (use-voice-capture
    // não pausa o mic) — sem essa trava, um turno detectado nesse meio-tempo
    // (ruído, eco do próprio TTS) dispara um segundo speakText() em paralelo,
    // sobrepondo duas vozes falando coisas diferentes (bug real observado).
    let processingTurn = false

    // Estado de alto nível pro widget flutuante (caption + animação). Distinto
    // de capture.state() (que só descreve o microfone: idle/listening/"user
    // speaking") — aqui "pensando" cobre transcrição+roteamento, e "respondendo"
    // cobre a reprodução do áudio do Breniac, coisas que capture.state() não
    // enxerga.
    type Phase = "off" | "listening" | "thinking" | "responding"
    const [pipelinePhase, setPipelinePhase] = createSignal<"idle" | "thinking" | "responding">("idle")
    const phase = (): Phase => {
      if (capture.state() === "idle") return "off"
      if (pipelinePhase() === "thinking") return "thinking"
      if (pipelinePhase() === "responding") return "responding"
      return "listening"
    }

    const capture = createVoiceCapture((audio) => {
      if (processingTurn) return
      processingTurn = true
      setPipelinePhase("thinking")
      const sessionID = voiceSessionID
      let transcript = ""
      const route = layout.route()
      const sessionContextPromise =
        route.type === "session" ? getLastAssistantMessage(serverSDK, route.sessionId, currentDirectory() ?? "") : undefined
      Promise.resolve(sessionContextPromise)
        .catch(() => undefined)
        .then((sessionContext) =>
          transcribeTurn(serverSDK, audio).then((text) => {
            if (isLikelyHallucination(text)) throw new Error("skip-hallucinated-turn")
            transcript = text
            return routeTurn(serverSDK, text, command.options, memoryContext || undefined, currentScreen(), sessionContext)
          }),
        )
        .then(execute)
        .then(async (confirmation) => {
          setPipelinePhase("responding")
          await speakText(serverSDK, confirmation)
          if (sessionID) await appendTurn(serverSDK, sessionID, transcript, confirmation)
        })
        .catch((error) => {
          if (error instanceof Error && error.message === "skip-hallucinated-turn") return
          console.error("[breniac] falha ao processar turno", error)
        })
        .finally(() => {
          processingTurn = false
          setPipelinePhase("idle")
        })
    })

    const toggle = async () => {
      if (capture.state() === "idle") {
        voiceSessionID = crypto.randomUUID()
        memoryContext = await loadMemoryContext(serverSDK, currentDirectory())
        await capture.start()
        return
      }

      const sessionID = voiceSessionID
      voiceSessionID = undefined
      capture.stop()

      const directory = currentDirectory()
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
        // Sinônimos explícitos pro roteador (#43) reconhecer — sem isso "pode
        // encerrar"/"para de ouvir" caía em answer_directly, que só FALA que
        // encerrou sem realmente desligar o microfone (bug real observado).
        description: language.t("breniac.command.toggle.description"),
        category: language.t("command.category.settings"),
        keybind: "mod+shift+b",
        onSelect: () => void toggle(),
      },
    ])

    // Expõe "abrir projeto X" pra cada projeto já adicionado ao opencode como
    // comando de app real — sem isso o roteador (#43) não tinha como cumprir
    // um pedido de voz pra abrir um projeto específico, só via prompt de sessão.
    command.register("breniac.projects", () =>
      layout.projects.list().map((project) => ({
        id: `breniac.openProject:${project.worktree}`,
        title: language.t("breniac.command.openProject", { name: displayName(project) }),
        category: language.t("command.category.settings"),
        onSelect: () => {
          layout.projects.open(project.worktree)
          navigate(`/${base64Encode(project.worktree)}/session`)
        },
      })),
    )

    // Sessões recentes do projeto atualmente aberto — sem isso o roteador só
    // conseguia "abrir projeto" (que sempre cai numa sessão nova) e nunca
    // "continuar a sessão X", deixando o Breniac sem opção quando o usuário
    // queria voltar pra uma conversa existente em vez de começar outra.
    const [recentSessions] = createResource(currentDirectory, async (directory) => {
      if (!directory) return []
      return listRecentSessions(serverSDK, directory)
    })
    command.register("breniac.sessions", () => {
      const directory = currentDirectory()
      if (!directory) return []
      const dirBase64 = base64Encode(directory)
      return (recentSessions() ?? []).map((session) => ({
        id: `breniac.openSession:${dirBase64}:${session.id}`,
        title: language.t("breniac.command.openSession", {
          title: session.title.trim() || language.t("breniac.command.openSession.untitled"),
        }),
        category: language.t("command.category.settings"),
        onSelect: () => navigate(`/${dirBase64}/session/${session.id}`),
      }))
    })

    return {
      state: capture.state,
      phase,
      on: () => capture.state() !== "idle",
      toggle,
      enabled: () => enabledResource() ?? false,
      refreshEnabled: () => void refreshEnabled(),
    }
  },
})

export type { VoiceCaptureState }
