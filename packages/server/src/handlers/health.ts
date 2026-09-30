import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Api } from "../api"

export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  handlers.handle("health.get", () => Effect.succeed({ healthy: true as const, version: InstallationVersion })),
)
