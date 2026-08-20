import type { useServerSDK } from "@/context/server-sdk"

let audioContext: AudioContext | undefined
function getAudioContext() {
  audioContext ??= new AudioContext()
  return audioContext
}

function pcm16ToAudioBuffer(bytes: Uint8Array, sampleRate: number, channels: number, ctx: AudioContext) {
  const frameCount = bytes.length / 2 / channels
  const buffer = ctx.createBuffer(channels, frameCount, sampleRate)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < frameCount; i++) {
      const sampleIndex = (i * channels + channel) * 2
      data[i] = view.getInt16(sampleIndex, true) / 32768
    }
  }
  return buffer
}

export async function speakText(serverSDK: ReturnType<typeof useServerSDK>, text: string): Promise<void> {
  const result = await serverSDK().client.breniac.speak({ breniacSpeakRequest: { text } })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha na fala")
  const data = result.data
  if (!data) throw new Error("Breniac: resposta de fala vazia")

  const binary = atob(data.audio)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const ctx = getAudioContext()
  await ctx.resume()
  const buffer = pcm16ToAudioBuffer(bytes, Number(data.sampleRate), Number(data.channels), ctx)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  await new Promise<void>((resolve) => {
    source.onended = () => resolve()
    source.start()
  })
}
