#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Daemon } from "./services/daemon"
import { EnvironmentRegistry } from "./services/environment-registry"
import { ScheduleRegistry } from "./services/schedule-registry"

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  api: () => import("./commands/handlers/api"),
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
  },
  migrate: () => import("./commands/handlers/migrate"),
  environment: {
    add: () => import("./commands/handlers/environment/add"),
    list: () => import("./commands/handlers/environment/list"),
    rm: () => import("./commands/handlers/environment/rm"),
  },
  schedule: {
    add: () => import("./commands/handlers/schedule/add"),
    list: () => import("./commands/handlers/schedule/list"),
    rm: () => import("./commands/handlers/schedule/rm"),
  },
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    password: () => import("./commands/handlers/service/password"),
  },
  serve: () => import("./commands/handlers/serve"),
})

Runtime.run(Commands, Handlers, { version: "local" }).pipe(
  Effect.provide(ScheduleRegistry.layer),
  Effect.provide(EnvironmentRegistry.layer),
  Effect.provide(Daemon.layer),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
)
