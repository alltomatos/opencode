import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { fileURLToPath } from "url"
import { Effect, Layer, Schema, Context } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { MCP } from "@/mcp"

const file = path.join(Global.Path.data, "mcpmail-accounts.json")

const mcpmailEntrypoint = () => fileURLToPath(import.meta.resolve("mcpmail"))

const fail = (message: string) => (cause: unknown) => new MailAccountsError({ message, cause })

export const SmtpConfig = Schema.Struct({
  host: Schema.String,
  port: PositiveInt,
  secure: Schema.Boolean,
})
export type SmtpConfig = Schema.Schema.Type<typeof SmtpConfig>

export class Account extends Schema.Class<Account>("MailAccount")({
  id: Schema.String,
  label: Schema.String,
  provider: Schema.String,
  host: Schema.String,
  port: PositiveInt,
  secure: Schema.Boolean,
  user: Schema.String,
  appPassword: Schema.String,
  smtp: Schema.optional(SmtpConfig),
}) {}

// Same shape as `Account` minus the secret, for anything returned to the frontend.
export class AccountSummary extends Schema.Class<AccountSummary>("MailAccountSummary")({
  id: Schema.String,
  label: Schema.String,
  provider: Schema.String,
  host: Schema.String,
  port: PositiveInt,
  secure: Schema.Boolean,
  user: Schema.String,
  smtp: Schema.optional(SmtpConfig),
}) {}

const toSummary = (account: Account): AccountSummary =>
  new AccountSummary({
    id: account.id,
    label: account.label,
    provider: account.provider,
    host: account.host,
    port: account.port,
    secure: account.secure,
    user: account.user,
    smtp: account.smtp,
  })

export class MailAccountsError extends Schema.TaggedErrorClass<MailAccountsError>()("MailAccountsError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly all: () => Effect.Effect<AccountSummary[], MailAccountsError>
  readonly upsert: (account: Account) => Effect.Effect<AccountSummary[], MailAccountsError>
  readonly remove: (id: string) => Effect.Effect<AccountSummary[], MailAccountsError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MailAccounts") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const decode = Schema.decodeUnknownOption(Schema.Array(Account))

    const readAccounts = Effect.fn("MailAccounts.readAccounts")(function* () {
      const data = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => [] as unknown))
      return decode(data).pipe((opt) => (opt._tag === "Some" ? opt.value : []))
    })

    const writeAccounts = Effect.fn("MailAccounts.writeAccounts")(function* (accounts: Account[]) {
      yield* fsys.writeJson(file, accounts, 0o600).pipe(Effect.mapError(fail("Failed to write mail accounts")))
    })

    // The mcpmail process only reads accounts.json on startup, so any account change
    // needs a fresh MCP.add to (re)register/restart it with the current file.
    const syncMcpServer = Effect.fn("MailAccounts.syncMcpServer")(function* (accounts: Account[]) {
      if (accounts.length === 0) return
      yield* mcp.add("mcpmail", {
        type: "local",
        command: [process.execPath, mcpmailEntrypoint()],
        environment: { MAIL_MCP_ACCOUNTS_PATH: file },
      })
    })

    const all = Effect.fn("MailAccounts.all")(function* () {
      return (yield* readAccounts()).map(toSummary)
    })

    const upsert = Effect.fn("MailAccounts.upsert")(function* (account: Account) {
      const existing = yield* readAccounts()
      const next = [...existing.filter((a) => a.id !== account.id), account]
      yield* writeAccounts(next)
      yield* syncMcpServer(next)
      return next.map(toSummary)
    })

    const remove = Effect.fn("MailAccounts.remove")(function* (id: string) {
      const existing = yield* readAccounts()
      const next = existing.filter((a) => a.id !== id)
      yield* writeAccounts(next)
      yield* syncMcpServer(next)
      return next.map(toSummary)
    })

    return Service.of({ all, upsert, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, MCP.node] })

export * as MailAccounts from "."
