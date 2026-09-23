import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { Effect, Layer, Schema, Context } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { MCP } from "@/mcp"

const file = path.join(Global.Path.data, "mcpmail-accounts.json")

const resolveNodeBinary = (): string => {
  if (process.platform === "win32") {
    // Check common Windows node install locations
    const candidatePaths = [
      "C:\\nvm4w\\nodejs\\node.exe",
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files (x86)\\nodejs\\node.exe",
    ]
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p
    }
  } else {
    // macOS / Linux common paths (NVM, Homebrew, standard bin)
    const candidatePaths = [
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
    ]
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p
    }
  }
  return "node"
}

const resolveMcpmailLauncher = (): { command: string[]; env?: Record<string, string> } => {
  const nodeBin = resolveNodeBinary()

  // 1. Check packaged resources directory (Desktop app packaged)
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === "string") {
    const resourceEntry = path.join(resourcesPath, "mcpmail", "index.js")
    if (fs.existsSync(resourceEntry)) {
      return {
        command: [nodeBin, resourceEntry],
      }
    }
  }

  // 2. Check candidate locations across the filesystem
  const candidateLocations = [
    path.join(Global.Path.data, "resources", "mcpmail", "index.js"),
    "D:\\dev\\opencode\\packages\\desktop\\resources\\mcpmail\\index.js",
    path.join(process.cwd(), "packages", "desktop", "resources", "mcpmail", "index.js"),
    path.join(process.cwd(), "resources", "mcpmail", "index.js"),
    path.join(process.cwd(), "packages", "mcpmail", "src", "index.ts"),
    "D:\\dev\\opencode\\packages\\mcpmail\\src\\index.ts",
  ]

  for (const loc of candidateLocations) {
    if (fs.existsSync(loc)) {
      if (loc.endsWith(".ts")) {
        return {
          command: typeof Bun !== "undefined" ? [process.execPath, loc] : ["bun", loc],
        }
      }
      return {
        command: [nodeBin, loc],
      }
    }
  }

  // 3. Try import.meta.resolve fallback
  try {
    const resolved = fileURLToPath(import.meta.resolve("mcpmail"))
    if (fs.existsSync(resolved)) {
      return {
        command: typeof Bun !== "undefined" ? [process.execPath, resolved] : [nodeBin, resolved],
      }
    }
  } catch {}

  // 4. Fallback path
  return {
    command: [nodeBin, "D:\\dev\\opencode\\packages\\desktop\\resources\\mcpmail\\index.js"],
  }
}

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

export class TestResult extends Schema.Class<TestResult>("MailTestResult")({
  ok: Schema.Boolean,
  imap: Schema.Struct({
    ok: Schema.Boolean,
    message: Schema.String,
    log: Schema.optional(Schema.String),
  }),
  smtp: Schema.optional(
    Schema.Struct({
      ok: Schema.Boolean,
      message: Schema.String,
      log: Schema.optional(Schema.String),
    }),
  ),
}) {}

export class MailAccountsError extends Schema.TaggedErrorClass<MailAccountsError>()("MailAccountsError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly all: () => Effect.Effect<AccountSummary[], MailAccountsError>
  readonly upsert: (account: Account) => Effect.Effect<AccountSummary[], MailAccountsError>
  readonly remove: (id: string) => Effect.Effect<AccountSummary[], MailAccountsError>
  readonly testConnection: (account: Account) => Effect.Effect<TestResult, MailAccountsError>
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
    // needs a fresh MCP.add to (re)register/restart it with the current file, or MCP.remove when no accounts remain.
    const syncMcpServer = Effect.fn("MailAccounts.syncMcpServer")(function* (accounts: Account[]) {
      if (accounts.length === 0) {
        yield* mcp.remove("mcpmail").pipe(Effect.ignore)
        return
      }
      const launcher = resolveMcpmailLauncher()
      yield* mcp.add("mcpmail", {
        type: "local",
        command: launcher.command,
        environment: {
          MAIL_MCP_ACCOUNTS_PATH: file,
          ...launcher.env,
        },
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

    const testConnection = Effect.fn("MailAccounts.testConnection")(function* (account: Account) {
      const imapRes = yield* Effect.promise(async () => {
        try {
          const { ImapFlow } = await import("imapflow")
          const client = new ImapFlow({
            host: account.host,
            port: account.port,
            secure: account.secure,
            auth: {
              user: account.user,
              pass: account.appPassword,
            },
            logger: false,
          })
          await client.connect()
          const mailboxes = await client.list()
          await client.logout().catch(() => client.close())
          return {
            ok: true,
            message: "Conectado e autenticado com sucesso no servidor IMAP.",
            log: `Conexão estabelecida com ${account.host}:${account.port} (TLS: ${account.secure}). Total de caixas de entrada/pastas encontradas: ${mailboxes.length}.`,
          }
        } catch (err) {
          const msg = (err as Error).message || String(err)
          return {
            ok: false,
            message: msg || "Falha na conexão IMAP.",
            log: `Erro de conexão com IMAP (${account.host}:${account.port}):\n${(err as Error).stack || msg}`,
          }
        }
      })

      let smtpRes: { ok: boolean; message: string; log?: string } | undefined
      if (account.smtp) {
        smtpRes = yield* Effect.promise(async () => {
          try {
            const { createTransport } = await import("nodemailer")
            const transporter = createTransport({
              host: account.smtp!.host,
              port: account.smtp!.port,
              secure: account.smtp!.secure,
              auth: {
                user: account.user,
                pass: account.appPassword,
              },
            })
            await transporter.verify()
            transporter.close()
            return {
              ok: true,
              message: "Conectado e autenticado com sucesso no servidor SMTP.",
              log: `Conexão SMTP verificada com sucesso em ${account.smtp!.host}:${account.smtp!.port} (Seguro: ${account.smtp!.secure}).`,
            }
          } catch (err) {
            const msg = (err as Error).message || String(err)
            return {
              ok: false,
              message: msg || "Falha na conexão SMTP.",
              log: `Erro de conexão com SMTP (${account.smtp!.host}:${account.smtp!.port}):\n${(err as Error).stack || msg}`,
            }
          }
        })
      }

      const ok = imapRes.ok && (!smtpRes || smtpRes.ok)
      return new TestResult({
        ok,
        imap: imapRes,
        smtp: smtpRes,
      })
    })

    return Service.of({ all, upsert, remove, testConnection })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, MCP.node] })

export * as MailAccounts from "."
