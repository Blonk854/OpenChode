import { Credential } from "@opencode/core/credential"
import { CredentialQuota } from "@opencode/core/credential/quota"
import { ConflictError, CredentialNotFoundError, InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.list",
      Effect.fn(function* () {
        const credential = yield* Credential.Service
        return { data: entries(yield* credential.all()) }
      }),
    )
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        if (ctx.payload.id && (yield* credential.get(ctx.payload.id)))
          return yield* new ConflictError({
            resource: ctx.payload.id,
            message: `Credential already exists: ${ctx.payload.id}`,
          })
        const created = yield* credential.create(ctx.payload)
        const entry = entries(yield* credential.list(created.integrationID)).find((item) => item.id === created.id)
        return { data: entry ?? { ...created, active: false } }
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.activate",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.activate(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        const credential = yield* Credential.Service
        yield* credential.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.usage",
      Effect.fn(function* () {
        const quota = yield* CredentialQuota.Service
        return yield* quota.report()
      }),
    )
    .handle(
      "credential.limit",
      Effect.fn(function* (ctx) {
        const quota = yield* CredentialQuota.Service
        yield* quota.setLimit(ctx.params.credentialID, ctx.payload.limit).pipe(
          Effect.catchTag("CredentialQuota.MissingError", (error) =>
            Effect.fail(
              new CredentialNotFoundError({
                credentialID: error.credentialID,
                message: `Credential not found: ${error.credentialID}`,
              }),
            ),
          ),
          Effect.catchTag("CredentialQuota.RejectedLimitError", (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message })),
          ),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.unblock",
      Effect.fn(function* (ctx) {
        const quota = yield* CredentialQuota.Service
        yield* quota.clearBlock(ctx.params.credentialID).pipe(
          Effect.catchTag("CredentialQuota.MissingError", (error) =>
            Effect.fail(
              new CredentialNotFoundError({
                credentialID: error.credentialID,
                message: `Credential not found: ${error.credentialID}`,
              }),
            ),
          ),
        )
        return HttpApiSchema.NoContent.make()
      }),
    ),
)

// Credential listings order each integration's selected credential last.
function entries(credentials: Credential.Info[]) {
  const selected = new Map(credentials.map((item) => [item.integrationID, item.id]))
  return credentials.map((item) => ({
    id: item.id,
    integrationID: item.integrationID,
    label: item.label,
    active: selected.get(item.integrationID) === item.id,
    value: item.value,
  }))
}
