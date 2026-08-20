import { createSignal, onCleanup } from "solid-js"

/**
 * Fase 1 (turnos discretos): grava enquanto o usuário fala e corta o turno
 * numa pausa simples de volume — não é VAD sofisticado nem duplex/streaming.
 * Um "turno" começa quando o volume passa `SPEECH_THRESHOLD` e termina depois
 * de `SILENCE_MS` de silêncio contínuo (só depois de já ter detectado fala).
 */

const SPEECH_THRESHOLD = 0.02 // RMS (0..1) acima do qual consideramos "falando"
const SILENCE_MS = 1200 // silêncio contínuo pra fechar o turno
const ANALYSIS_INTERVAL_MS = 100
const MIN_TURN_MS = 300 // ignora ruídos curtos (blobs vazios/insignificantes)

export type VoiceCaptureState = "idle" | "listening" | "speaking"

export interface VoiceCapture {
  readonly state: () => VoiceCaptureState
  /** Pede permissão de mic e começa a escutar por turnos. */
  start: () => Promise<void>
  /** Solta o microfone e para de escutar. */
  stop: () => void
}

export function createVoiceCapture(onTurn: (audio: Blob) => void): VoiceCapture {
  const [state, setState] = createSignal<VoiceCaptureState>("idle")

  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let recorder: MediaRecorder | undefined
  let chunks: Blob[] = []
  let silenceSince: number | undefined
  let speechStarted = false
  let turnStartedAt = 0
  let analysisTimer: ReturnType<typeof setInterval> | undefined

  const rms = (data: Uint8Array) => {
    let sumSquares = 0
    for (const sample of data) {
      const normalized = (sample - 128) / 128
      sumSquares += normalized * normalized
    }
    return Math.sqrt(sumSquares / data.length)
  }

  const beginRecording = () => {
    if (!stream) return
    chunks = []
    speechStarted = false
    silenceSince = undefined
    turnStartedAt = Date.now()
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.start()
  }

  const finishTurn = () => {
    if (!recorder) return
    const finishedRecorder = recorder
    recorder = undefined
    const elapsed = Date.now() - turnStartedAt
    finishedRecorder.onstop = () => {
      if (speechStarted && elapsed >= MIN_TURN_MS && chunks.length > 0) {
        onTurn(new Blob(chunks, { type: finishedRecorder.mimeType || "audio/webm" }))
      }
      if (state() !== "idle") beginRecording()
    }
    finishedRecorder.stop()
  }

  const analyze = () => {
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    const level = rms(data)
    const speaking = level > SPEECH_THRESHOLD

    if (speaking) {
      speechStarted = true
      silenceSince = undefined
      setState("speaking")
      return
    }

    setState("listening")
    if (!speechStarted) return

    if (silenceSince === undefined) {
      silenceSince = Date.now()
      return
    }
    if (Date.now() - silenceSince >= SILENCE_MS) finishTurn()
  }

  const start = async () => {
    if (state() !== "idle") return
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    setState("listening")
    beginRecording()
    analysisTimer = setInterval(analyze, ANALYSIS_INTERVAL_MS)
  }

  const stop = () => {
    if (analysisTimer) clearInterval(analysisTimer)
    analysisTimer = undefined
    if (recorder) {
      recorder.onstop = null
      recorder.stop()
      recorder = undefined
    }
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = undefined
    void audioContext?.close()
    audioContext = undefined
    analyser = undefined
    setState("idle")
  }

  onCleanup(stop)

  return { state, start, stop }
}
