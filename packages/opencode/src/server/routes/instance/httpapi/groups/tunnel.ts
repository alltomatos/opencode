import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { TunnelError, Status as TunnelStatus } from "@/tunnel"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/tunnel"

export const StartPayload = Schema.Struct({ port: Schema.Number })

export const TunnelApi = HttpApi.make("tunnel")
  .add(
    HttpApiGroup.make("tunnel")
      .add(
        // Starts (or returns the already-running) cloudflared quick tunnel
        // exposing `http://localhost:<port>` publicly — see Tunnel.Service.
        // Used by the AgentUI form so a WhatsApp webhook URL pointing at
        // 127.0.0.1/localhost can be swapped for one izapia (or any other
        // waconector provider) can actually reach.
        HttpApiEndpoint.post("start", `${root}/start`, {
          payload: StartPayload,
          success: described(TunnelStatus, "Tunnel started (or already running)"),
          error: TunnelError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tunnel.start",
            summary: "Start public tunnel",
            description: "Starts a cloudflared quick tunnel exposing this server's given local port publicly.",
          }),
        ),
        HttpApiEndpoint.get("status", `${root}/status`, {
          success: described(TunnelStatus, "Current tunnel status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tunnel.status",
            summary: "Get tunnel status",
          }),
        ),
        HttpApiEndpoint.post("stop", `${root}/stop`, {
          success: described(Schema.Struct({ ok: Schema.Literal(true) }), "Tunnel stopped"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tunnel.stop",
            summary: "Stop public tunnel",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "tunnel",
          description: "Experimental HttpApi public tunnel routes (cloudflared quick tunnel).",
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
