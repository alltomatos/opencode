export * as Credential from "./credential"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { CredentialTable } from "./credential/sql"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const Value = Credential.Value
export type Value = Credential.Value

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decode = Schema.decodeUnknownSync(Value)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
      })
    }

    const deduplicate = Effect.fnUntraced(function* (rows: (typeof CredentialTable.$inferSelect)[]) {
      const seen = new Map<string, typeof CredentialTable.$inferSelect>()
      const duplicatesToRemove: string[] = []

      for (const row of rows) {
        if (!row.integration_id) continue
        const val = row.value as { metadata?: { email?: string } } | undefined
        const email = val?.metadata?.email
        const key = `${row.integration_id}:${email ?? row.label}`

        const existing = seen.get(key)
        if (existing) {
          // Keep the newer entry, mark older for removal
          const existingUpdated = (existing.time_updated ?? existing.time_created ?? 0) as number
          const currentUpdated = (row.time_updated ?? row.time_created ?? 0) as number
          if (currentUpdated >= existingUpdated) {
            duplicatesToRemove.push(existing.id)
            seen.set(key, row)
          } else {
            duplicatesToRemove.push(row.id)
          }
        } else {
          seen.set(key, row)
        }
      }

      if (duplicatesToRemove.length > 0) {
        for (const id of duplicatesToRemove) {
          yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id as any)).run().pipe(Effect.orDie)
        }
      }

      return Array.from(seen.values())
    })

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const unique = yield* deduplicate(rows)
        return unique.flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const unique = yield* deduplicate(rows)
        return unique.flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const targetLabel = input.label ?? "default"
        const inputVal = input.value as { metadata?: { email?: string } } | undefined
        const targetEmail = inputVal?.metadata?.email

        const existingRows = yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, input.integrationID))
          .all()
          .pipe(Effect.orDie)

        const match = existingRows.find((row) => {
          if (targetEmail) {
            const val = row.value as { metadata?: { email?: string } } | undefined
            if (val?.metadata?.email && val.metadata.email === targetEmail) return true
            if (row.label === targetEmail) return true
          }
          if (targetLabel !== "default" && row.label === targetLabel) return true
          return false
        })

        if (match) {
          yield* db
            .update(CredentialTable)
            .set({
              label: targetLabel,
              value: input.value,
              time_updated: Date.now(),
            })
            .where(eq(CredentialTable.id, match.id))
            .run()
            .pipe(Effect.orDie)

          return new Info({
            id: match.id,
            integrationID: input.integrationID,
            label: targetLabel,
            value: input.value,
          })
        }

        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: targetLabel,
          value: input.value,
        })
        yield* db
          .insert(CredentialTable)
          .values({
            id: credential.id,
            integration_id: credential.integrationID,
            label: credential.label,
            value: credential.value,
          })
          .run()
          .pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
