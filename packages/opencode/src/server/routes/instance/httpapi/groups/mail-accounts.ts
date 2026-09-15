import { MailAccounts } from "@/mail-accounts"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const SmtpPayload = Schema.Struct({
  host: Schema.String,
  port: PositiveInt,
  secure: Schema.Boolean,
})

export const UpsertPayload = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  provider: Schema.String,
  host: Schema.String,
  port: PositiveInt,
  secure: Schema.Boolean,
  user: Schema.String,
  appPassword: Schema.String,
  smtp: Schema.optional(SmtpPayload),
})

export const AccountList = Schema.Array(MailAccounts.AccountSummary)

export const MailAccountsPaths = {
  collection: "/mail/accounts",
  item: "/mail/accounts/:id",
} as const

export const MailAccountsApi = HttpApi.make("mail-accounts").add(
  HttpApiGroup.make("mailAccounts")
    .add(
      HttpApiEndpoint.get("list", MailAccountsPaths.collection, {
        query: WorkspaceRoutingQuery,
        success: described(AccountList, "Configured mail accounts (without secrets)"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mailAccounts.list",
          summary: "List mail accounts",
          description: "List configured mcpmail accounts (App Password never included in the response).",
        }),
      ),
      HttpApiEndpoint.post("add", MailAccountsPaths.collection, {
        query: WorkspaceRoutingQuery,
        payload: UpsertPayload,
        success: described(AccountList, "Mail account saved successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mailAccounts.add",
          summary: "Add or update a mail account",
          description:
            "Create or update a mcpmail account (IMAP/SMTP + App Password) and (re)register the mcpmail MCP server.",
        }),
      ),
      HttpApiEndpoint.delete("remove", MailAccountsPaths.item, {
        params: { id: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(AccountList, "Mail account removed successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mailAccounts.remove",
          summary: "Remove a mail account",
          description: "Remove a configured mcpmail account.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "mailAccounts",
        description: "Mail accounts (mcpmail) configuration routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
