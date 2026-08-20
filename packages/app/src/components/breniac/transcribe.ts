import type { useServerSDK } from "@/context/server-sdk"

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export async function transcribeTurn(serverSDK: ReturnType<typeof useServerSDK>, audio: Blob): Promise<string> {
  const base64 = await blobToBase64(audio)
  const result = await serverSDK().client.breniac.transcribe({
    breniacTranscribeRequest: { audio: base64, mimeType: audio.type || "audio/webm" },
  })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha na transcrição")
  return result.data?.text ?? ""
}
