export * as LocationsResolver from "./location-resolver"

import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { Location } from "./location"
import { LocationServiceMap } from "./location-service-map"
import { makeGlobalNode, type GlobalNode } from "./effect/app-node"

// Interface estreita: expõe apenas o Database da Location, sem referenciar
// `LocationServices`. É o que permite read-path (SessionStore) depender do
// dono único das conexões de location sem fechar o ciclo de tipos
// `LocationServices ↔ SessionStore`.
export interface Interface {
  readonly get: (ref: Location.Ref) => Effect.Effect<Database.Interface>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/example/LocationsResolver") {}

// Anotações explícitas: o grafo de tipos LocationServiceMap ↔ LocationServices
// ↔ SessionStore é grande; sem elas o TS entra em inferência recursiva (TS7022).
const layer: Layer.Layer<Service, never, LocationServiceMap.Service | Database.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const fallbackDb = yield* Database.Service
    return Service.of({
      // Fornece a camada cacheada do LocationServiceMap e lê o Database.Service
      // resolvido por ela. Como o LayerMap é respaldado por RcMap, o contexto
      // devolvido é o MESMO que os serviços de location usam, e a referência é
      // liberada ao fim de cada `get` (eviction por TTL fecha a conexão).
      get: (ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffect(ref)
          return Context.get(context, Database.Service)
        }).pipe(
          Effect.scoped,
          Effect.provideService(LocationServiceMap.Service, locations),
          Effect.catchDefect(() => Effect.succeed(fallbackDb)),
          Effect.orDie,
        ),
    })
  }),
)

// Unbound como o LocationServiceMap: `deps` referencia o nó do mapa, e o
// AppNodeBuilder liga ambos quando o grafo raiz os exige.
export const node: GlobalNode<Service> = makeGlobalNode({
  service: Service,
  layer,
  deps: [LocationServiceMap.node, Database.node],
})

// Dentro do build de uma location o mapa dono não existe (é o próprio build em
// curso), então o resolver responde com o Database daquela location. Substitui
// `node` no compile da location (ver buildLocationServiceMap).
export const localNode: GlobalNode<Service> = makeGlobalNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      return Service.of({ get: () => Effect.succeed(database) })
    }),
  ),
  deps: [Database.node],
})
