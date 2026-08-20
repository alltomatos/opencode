import type { CommandOption } from "@/context/command"
import type { useServerSDK } from "@/context/server-sdk"

export type BreniacRoute = { kind: "appCommand"; commandID: string } | { kind: "sessionPrompt"; prompt: string }

export async function routeTurn(
  serverSDK: ReturnType<typeof useServerSDK>,
  text: string,
  commands: CommandOption[],
): Promise<BreniacRoute> {
  const result = await serverSDK().client.breniac.route({
    breniacRouteRequest: {
      text,
      commands: commands.map((option) => ({ id: option.id, title: option.title, description: option.description })),
    },
  })
  if (result.error) throw new Error("message" in result.error ? result.error.message : "Breniac: falha no roteamento")
  const data = result.data
  if (!data) throw new Error("Breniac: roteador não retornou nada")
  if (data.kind === "appCommand" && data.commandID) return { kind: "appCommand", commandID: data.commandID }
  return { kind: "sessionPrompt", prompt: data.prompt ?? text }
}
