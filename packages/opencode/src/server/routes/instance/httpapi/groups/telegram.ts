import { Telegram } from "@/telegram"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const ConnectPayload = Schema.Struct({
  token: Schema.String,
})

export const TelegramPaths = {
  status: "/telegram",
  connect: "/telegram/connect",
  disconnect: "/telegram/disconnect",
} as const

export const TelegramApi = HttpApi.make("telegram")
  .add(
    HttpApiGroup.make("telegram")
      .add(
        HttpApiEndpoint.get("status", TelegramPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(Telegram.Status, "Telegram bot connection status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telegram.status",
            summary: "Get Telegram bot status",
            description: "Get whether a Telegram bot is connected, and its username if so.",
          }),
        ),
        HttpApiEndpoint.post("connect", TelegramPaths.connect, {
          query: WorkspaceRoutingQuery,
          payload: ConnectPayload,
          success: described(Telegram.BotInfo, "Telegram bot connected successfully"),
          error: [Telegram.InvalidTokenError, HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telegram.connect",
            summary: "Connect a Telegram bot",
            description: "Validate a Telegram bot token via getMe and store it as the active bot.",
          }),
        ),
        HttpApiEndpoint.post("disconnect", TelegramPaths.disconnect, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Literal(true), "Telegram bot disconnected successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "telegram.disconnect",
            summary: "Disconnect the Telegram bot",
            description: "Remove the stored Telegram bot token.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "telegram",
          description: "Experimental HttpApi Telegram bot routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
