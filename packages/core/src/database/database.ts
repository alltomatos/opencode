export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode, makeLocationNode } from "../effect/app-node"
import { WorkspaceMigration } from "./workspace-migration"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

export class GlobalService extends Context.Service<GlobalService, Interface>()("@opencode/v2/storage/GlobalDatabase") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export const globalLayer = Layer.effect(
  GlobalService,
  Effect.gen(function* () {
    const service = yield* Service
    return GlobalService.of(service)
  }),
).pipe(Layer.provide(layerFromPath(path())))

export const globalNode = makeGlobalNode({ service: GlobalService, layer: globalLayer, deps: [] })

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function makeFromPath(filename: string) {
  return Effect.gen(function* () {
    const layer = layerFromPath(filename)
    return yield* Service.pipe(Effect.provide(layer))
  })
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return join(Global.Path.data, "global.db")
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
export const locationNode = (workspaceHash: string) =>
  makeGlobalNode({
    service: Service,
    layer: WorkspaceMigration.workspaceDatabaseLayer(workspaceHash),
    deps: [] as const,
  })
