import { MailAccounts } from "@/mail-accounts"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { UpsertPayload } from "../groups/mail-accounts"

const asBadRequest = Effect.mapError(() => new HttpApiError.BadRequest({}))

export const mailAccountsHandlers = HttpApiBuilder.group(InstanceHttpApi, "mailAccounts", (handlers) =>
  Effect.gen(function* () {
    const mailAccounts = yield* MailAccounts.Service

    const list = Effect.fn("MailAccountsHttpApi.list")(function* () {
      return yield* mailAccounts.all().pipe(asBadRequest)
    })

    const add = Effect.fn("MailAccountsHttpApi.add")(function* (ctx: { payload: typeof UpsertPayload.Type }) {
      return yield* mailAccounts.upsert(new MailAccounts.Account(ctx.payload)).pipe(asBadRequest)
    })

    const test = Effect.fn("MailAccountsHttpApi.test")(function* (ctx: { payload: typeof UpsertPayload.Type }) {
      return yield* mailAccounts.testConnection(new MailAccounts.Account(ctx.payload)).pipe(asBadRequest)
    })

    const remove = Effect.fn("MailAccountsHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      return yield* mailAccounts.remove(ctx.params.id).pipe(asBadRequest)
    })

    return handlers.handle("list", list).handle("test", test).handle("add", add).handle("remove", remove)
  }),
)
