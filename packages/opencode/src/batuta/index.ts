import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { Worktree } from "@/worktree"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Context, Effect, Layer, Schema } from "effect"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Batuta.NotFoundError", {
  id: Schema.String,
}) {}

export function parseModel(model: string) {
  const index = model.indexOf("/")
  if (index === -1) return { modelID: ModelV2.ID.make(model), providerID: ProviderV2.ID.make(model) }
  return { providerID: ProviderV2.ID.make(model.slice(0, index)), modelID: ModelV2.ID.make(model.slice(index + 1)) }
}

export interface RunningActivity {
  activity: ConfigBatutaV1.Activity
  /** worker id -> git worktree directory, only populated when the activity uses worktrees */
  workerDirectories: Map<string, string>
}

export interface Interface {
  readonly list: () => Effect.Effect<ConfigBatutaV1.Activity[]>
  readonly add: (activity: ConfigBatutaV1.Activity) => Effect.Effect<ConfigBatutaV1.Activity>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly start: (id: string) => Effect.Effect<{ sessionID: SessionID }, NotFoundError>
  /** Looked up by task.ts: is `label` a worker of a Batuta activity the given session (or one of its ancestors) is running? */
  readonly resolveWorker: (
    orchestratorSessionID: string,
    label: string,
  ) => Effect.Effect<{ worker: ConfigBatutaV1.Worker; directory?: string } | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Batuta") {}

const layer: Layer.Layer<Service, never, Config.Service | Session.Service | Worktree.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service
    const sessions = yield* Session.Service
    const worktree = yield* Worktree.Service

    // Orchestrator sessionID -> running activity state. Session IDs are
    // globally unique, so this doesn't need per-project isolation.
    const running = new Map<string, RunningActivity>()

    // In-memory overlay on top of disk config. Config.Service.updateGlobal
    // only invalidates its own global cache, not the per-instance merged
    // view Config.Service.get() reads — so a freshly added/removed activity
    // wouldn't be visible via get() alone until some later reload. Mirrors
    // the same overlay pattern used by MCP.Service.add for the same reason.
    const overlay = new Map<string, ConfigBatutaV1.Activity | undefined>()

    const list = Effect.fn("Batuta.list")(function* () {
      const cfg = yield* cfgSvc.get()
      const merged = new Map<string, ConfigBatutaV1.Activity>(Object.entries(cfg.batuta ?? {}))
      for (const [id, activity] of overlay) {
        if (activity) merged.set(id, activity)
        else merged.delete(id)
      }
      return Array.from(merged.values())
    })

    const add = Effect.fn("Batuta.add")(function* (activity: ConfigBatutaV1.Activity) {
      overlay.set(activity.id, activity)
      yield* cfgSvc.updateGlobal({ batuta: { [activity.id]: activity } } as unknown as ConfigV1.Info)
      return activity
    })

    const remove = Effect.fn("Batuta.remove")(function* (id: string) {
      overlay.set(id, undefined)
      yield* cfgSvc.updateGlobal({ batuta: { [id]: undefined } } as unknown as ConfigV1.Info)
    })

    const requireActivity = Effect.fn("Batuta.requireActivity")(function* (id: string) {
      const activities = yield* list()
      const activity = activities.find((item) => item.id === id)
      if (!activity) return yield* new NotFoundError({ id })
      return activity
    })

    const start = Effect.fn("Batuta.start")(function* (id: string) {
      const activity = yield* requireActivity(id)

      const workerDirectories = new Map<string, string>()
      if (activity.useWorktree) {
        for (const worker of activity.workers) {
          const info = yield* worktree.create({ name: worker.label }).pipe(
            Effect.catch((error) =>
              Effect.logError("Batuta.start: failed to create worker worktree", { worker: worker.label, error }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
          if (info) workerDirectories.set(worker.id, info.directory)
        }
      }

      const orchestratorModel = parseModel(activity.orchestratorModel)
      const session = yield* sessions.create({
        title: activity.name,
        model: { id: orchestratorModel.modelID, providerID: orchestratorModel.providerID },
      })

      running.set(session.id, { activity, workerDirectories })

      return { sessionID: session.id }
    })

    const resolveWorker = Effect.fn("Batuta.resolveWorker")(function* (orchestratorSessionID: string, label: string) {
      // V1: delegation only happens from the orchestrator session directly
      // (not from a grandchild), since that's the only session the running
      // activity is registered against.
      const entry = running.get(orchestratorSessionID)
      if (!entry) return undefined
      const worker = entry.activity.workers.find((item) => item.label === label)
      if (!worker) return undefined
      return { worker, directory: entry.workerDirectories.get(worker.id) }
    })

    return Service.of({ list, add, remove, start, resolveWorker })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Session.node, Worktree.node],
})

export * as Batuta from "."
