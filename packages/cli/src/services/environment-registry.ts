export * as EnvironmentRegistry from "./environment-registry"

import { Global } from "@opencode-ai/core/global"
import { Environment } from "@opencode-ai/schema/environment"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import path from "path"

export interface AddInput {
  readonly name: string
  readonly url: string
  readonly token?: string
  readonly ssh?: {
    readonly host: string
    readonly user: string
    readonly port?: number
    readonly keyPath?: string
  }
}

export interface Interface {
  readonly list: () => Effect.Effect<readonly Environment.Info[], unknown>
  readonly get: (idOrName: string) => Effect.Effect<Environment.Info | undefined, unknown>
  readonly add: (input: AddInput) => Effect.Effect<Environment.Info, unknown>
  readonly rm: (idOrName: string) => Effect.Effect<boolean, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/EnvironmentRegistry") {}

const EnvironmentsListSchema = Schema.Array(Environment.Info)
const decodeEnvironments = Schema.decodeUnknownEffect(Schema.fromJsonString(EnvironmentsListSchema))
const encodeEnvironments = Schema.encodeEffect(Schema.fromJsonString(EnvironmentsListSchema))

export const makeWithDirectory = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = path.join(directory, "environments.json")

    const read = Effect.fnUntraced(function* () {
      const content = yield* fs.readFileString(file).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!content || content.trim() === "") return []
      return yield* decodeEnvironments(content).pipe(
        Effect.catch(() => Effect.succeed([] as readonly Environment.Info[])),
      )
    })

    const write = (list: readonly Environment.Info[]) =>
      Effect.gen(function* () {
        const json = yield* encodeEnvironments(list)
        const temp = file + ".tmp"
        yield* fs.makeDirectory(directory, { recursive: true })
        yield* fs.writeFileString(temp, json, { mode: 0o600 })
        yield* fs.rename(temp, file)
      })

    const list = Effect.fn("cli.environment.list")(function* () {
      return yield* read()
    })

    const get = Effect.fn("cli.environment.get")(function* (idOrName: string) {
      const all = yield* read()
      return all.find((item) => item.id === idOrName || item.name === idOrName)
    })

    const add = Effect.fn("cli.environment.add")(function* (input: AddInput) {
      const all = yield* read()
      const existing = all.find((item) => item.name === input.name)
      if (existing) {
        return yield* Effect.fail(new Error(`Environment with name "${input.name}" already exists (${existing.id})`))
      }

      const newEnv: Environment.Info = {
        id: Environment.ID.create(),
        name: input.name,
        url: input.url,
        token: input.token,
        lastPairedAt: Date.now(),
        ssh: input.ssh,
      }

      const next = [...all, newEnv]
      yield* write(next)
      return newEnv
    })

    const rm = Effect.fn("cli.environment.rm")(function* (idOrName: string) {
      const all = yield* read()
      const filtered = all.filter((item) => item.id !== idOrName && item.name !== idOrName)
      if (filtered.length === all.length) {
        return false
      }
      yield* write(filtered)
      return true
    })

    return Service.of({
      list,
      get,
      add,
      rm,
    })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return yield* makeWithDirectory(Global.Path.config)
  }),
)
