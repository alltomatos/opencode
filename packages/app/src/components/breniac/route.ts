import type { CommandOption } from "@/context/command"
import type { useServerSDK } from "@/context/server-sdk"

export type BreniacRoute =
  | { kind: "appCommand"; commandID: string }
  | { kind: "sessionPrompt"; prompt: string }
  | { kind: "answer"; answer: string }

export async function routeTurn(
  serverSDK: ReturnType<typeof useServerSDK>,
  text: string,
  commands: CommandOption[],
  memoryContext?: string,
  currentScreen?: string,
  sessionContext?: string,
): Promise<BreniacRoute> {
  const result = await serverSDK().client.breniac.route({
    breniacRouteRequest: {
      text,
      commands: commands.map((option) => ({ id: option.id, title: option.title, description: option.description })),
      memoryContext,
      currentScreen,
      sessionContext,
    },
  })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha no roteamento")
  const data = result.data
  if (!data) throw new Error("Breniac: roteador não retornou nada")
  if (data.kind === "appCommand" && data.commandID) return { kind: "appCommand", commandID: data.commandID }
  if (data.kind === "answer") return { kind: "answer", answer: data.answer ?? "" }
  return { kind: "sessionPrompt", prompt: data.prompt ?? text }
}
