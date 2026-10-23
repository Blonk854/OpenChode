export * as CredentialQuota from "./quota.js"

import { and, eq, inArray, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Result, Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import type { TokenUsage } from "@opencode/schema/token-usage"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import {
  CredentialBlockTable,
  CredentialLimitTable,
  CredentialSnapshotTable,
  CredentialTable,
  CredentialUsageTable,
  CredentialWindowTable,
} from "./sql.js"
import { CredentialQuotaRouter } from "./quota-router.js"
import { googleCatalog, googlePageToken, openRouterCredit } from "./provider-snapshot.js"

export const Excluded = Context.Reference<ReadonlySet<string>>("@opencode/CredentialQuota/Excluded", {
  defaultValue: () => new Set<string>(),
})

export class MissingError extends Schema.TaggedError<MissingError>()("CredentialQuota.MissingError", {
  credentialID: Credential.ID,
}) {}

export class RejectedLimitError extends Schema.TaggedError<RejectedLimitError>()("CredentialQuota.RejectedLimitError", {
  credentialID: Credential.ID,
  message: Schema.String,
}) {}

export class ExhaustedError extends Schema.TaggedError<ExhaustedError>()("CredentialQuota.ExhaustedError", {
  integrationID: Integration.ID,
  message: Schema.String,
}) {}

export interface RecordedUsage {
  readonly tokens: TokenUsage.Info
  readonly cost: number
}

export type Choice =
  | { readonly mode: "passthrough" }
  | {
      readonly mode: "selected"
      readonly id: Credential.ID
      readonly label: string
      readonly value: Credential.Value
    }
  | { readonly mode: "exhausted" }

export interface Interface {
  readonly choose: (integrationID: Integration.ID) => Effect.Effect<Choice>
  readonly rotates: (integrationID: Integration.ID) => Effect.Effect<boolean>
  readonly block: (id: Credential.ID, retryAfterMs: number | undefined) => Effect.Effect<void>
  readonly clearBlock: (id: Credential.ID) => Effect.Effect<void, MissingError>
  readonly setLimit: (
    id: Credential.ID,
    limit: CredentialQuotaLimit | null,
  ) => Effect.Effect<void, MissingError | RejectedLimitError>
  readonly record: (input: {
    readonly credentialID: Credential.ID
    readonly providerID: string
    readonly modelID: string
    readonly usage: RecordedUsage
    readonly succeeded: boolean
  }) => Effect.Effect<void>
  readonly observe: (input: {
    readonly credentialID: Credential.ID
    readonly providerID: string
    readonly modelID: string
    readonly window: {
      readonly limit?: Record<string, string>
      readonly remaining?: Record<string, string>
      readonly reset?: Record<string, string>
    }
  }) => Effect.Effect<void>
  readonly refresh: () => Effect.Effect<void>
  readonly report: () => Effect.Effect<CredentialQuotaReport>
}

type CredentialQuotaLimit = { readonly metric: "requests" | "tokens" | "usd"; readonly amount: number }
type QuotaWindow = {
  readonly limit?: Record<string, string>
  readonly remaining?: Record<string, string>
  readonly reset?: Record<string, string>
  readonly observedAt: number
}
type QuotaCatalogModel = {
  readonly id: string
  readonly name: string
  readonly inputTokenLimit?: number
  readonly outputTokenLimit?: number
}
type QuotaCredit = { readonly limit?: number; readonly remaining?: number; readonly usage?: number }
type CredentialQuotaReport = {
  readonly providers: ReadonlyArray<{
    readonly integrationID: Integration.ID
    readonly accounts: ReadonlyArray<{
      readonly id: Credential.ID
      readonly label: string
      readonly limit?: CredentialQuotaLimit
      readonly used: { readonly requests: number; readonly tokens: number; readonly cost: number }
      readonly remaining?: number
      readonly blockedUntil?: number
      readonly window?: QuotaWindow
      readonly catalog?: ReadonlyArray<QuotaCatalogModel>
      readonly credit?: QuotaCredit
      readonly snapshotError?: string
      readonly models: ReadonlyArray<{
        readonly providerID: string
        readonly modelID: string
        readonly requests: number
        readonly tokens: number
        readonly cost: number
        readonly window?: QuotaWindow
        readonly inputTokenLimit?: number
        readonly outputTokenLimit?: number
      }>
    }>
    readonly combined: ReadonlyArray<{
      readonly metric: "requests" | "tokens" | "usd"
      readonly used: number
      readonly limit: number
      readonly remaining: number
    }>
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CredentialQuota") {}

const tokenTotal = (usage: TokenUsage.Info) =>
  usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write

const definedMap = (value: Record<string, string> | null | undefined) => {
  if (!value || Object.keys(value).length === 0) return undefined
  return value
}

const quotaWindow = (row: {
  readonly limit: Record<string, string> | null
  readonly remaining: Record<string, string> | null
  readonly reset: Record<string, string> | null
  readonly observed_at: number
}) => {
  const limit = definedMap(row.limit)
  const remaining = definedMap(row.remaining)
  const reset = definedMap(row.reset)
  if (!limit && !remaining && !reset) return undefined
  return {
    ...(limit ? { limit } : {}),
    ...(remaining ? { remaining } : {}),
    ...(reset ? { reset } : {}),
    observedAt: row.observed_at,
  } satisfies QuotaWindow
}

const fetchJson = (url: string, headers: Record<string, string>, label: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { headers }),
      catch: () => new Error(`${label} could not be reached`),
    })
    if (!response.ok) return yield* Effect.fail(new Error(`${label} returned HTTP ${response.status}`))
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new Error(`${label} returned an unreadable response`),
    })
  })

const readGoogle = (
  key: string,
  pageToken?: string,
  pages: readonly unknown[] = [],
): Effect.Effect<readonly QuotaCatalogModel[], Error> =>
  Effect.gen(function* () {
    if (pages.length >= 5) return googleCatalog(pages)
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models")
    url.searchParams.set("pageSize", "1000")
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const body = yield* fetchJson(url.toString(), { "x-goog-api-key": key }, "Google model list")
    const collected = [...pages, body]
    const next = googlePageToken(body)
    if (!next) return googleCatalog(collected)
    return yield* readGoogle(key, next, collected)
  })

const readOpenRouter = (key: string) =>
  fetchJson("https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` }, "OpenRouter key").pipe(
    Effect.map(openRouterCredit),
  )

const creditFrom = (
  snapshot:
    | {
        readonly credit_limit: number | null
        readonly credit_remaining: number | null
        readonly credit_usage: number | null
      }
    | undefined,
) => {
  if (!snapshot) return undefined
  const limit = snapshot.credit_limit ?? undefined
  const remaining = snapshot.credit_remaining ?? undefined
  const usage = snapshot.credit_usage ?? undefined
  if (limit === undefined && remaining === undefined && usage === undefined) return undefined
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(usage === undefined ? {} : { usage }),
  } satisfies QuotaCredit
}

const accountModels = (
  integrationID: string,
  usage: ReadonlyArray<{
    readonly provider_id: string
    readonly model_id: string
    readonly requests: number
    readonly tokens: number
    readonly cost: number
  }>,
  windows: ReadonlyArray<{
    readonly provider_id: string
    readonly model_id: string
    readonly limit: Record<string, string> | null
    readonly remaining: Record<string, string> | null
    readonly reset: Record<string, string> | null
    readonly observed_at: number
  }>,
  catalog: readonly QuotaCatalogModel[],
) => {
  const listed = usage.map((row) => {
    const window = quotaWindow(
      windows.find((item) => item.provider_id === row.provider_id && item.model_id === row.model_id) ?? {
        limit: null,
        remaining: null,
        reset: null,
        observed_at: 0,
      },
    )
    const match = catalog.find((item) => item.id === row.model_id)
    return {
      providerID: row.provider_id,
      modelID: row.model_id,
      requests: row.requests,
      tokens: row.tokens,
      cost: row.cost,
      ...(window ? { window } : {}),
      ...(match?.inputTokenLimit === undefined ? {} : { inputTokenLimit: match.inputTokenLimit }),
      ...(match?.outputTokenLimit === undefined ? {} : { outputTokenLimit: match.outputTokenLimit }),
    }
  })
  const seen = new Set(listed.map((model) => model.modelID))
  return [
    ...listed,
    ...catalog.flatMap((item) => {
      if (seen.has(item.id)) return []
      return [
        {
          providerID: integrationID,
          modelID: item.id,
          requests: 0,
          tokens: 0,
          cost: 0,
          ...(item.inputTokenLimit === undefined ? {} : { inputTokenLimit: item.inputTokenLimit }),
          ...(item.outputTokenLimit === undefined ? {} : { outputTokenLimit: item.outputTokenLimit }),
        },
      ]
    }),
  ]
}

const usedAmount = (
  metric: "requests" | "tokens" | "usd",
  usage: { readonly requests: number; readonly tokens: number; readonly cost: number },
) => {
  if (metric === "requests") return usage.requests
  if (metric === "tokens") return usage.tokens
  return usage.cost
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const rowsFor = Effect.fn("CredentialQuota.rows")(function* (integrationID: Integration.ID) {
      return yield* db
        .select()
        .from(CredentialTable)
        .where(eq(CredentialTable.integration_id, integrationID))
        .all()
        .pipe(Effect.orDie)
    })

    const candidates = (rows: ReadonlyArray<typeof CredentialTable.$inferSelect>) =>
      rows.flatMap((row) => {
        if (!row.integration_id) return []
        return [
          {
            id: row.id,
            label: row.label,
            type: row.value.type,
            active: row.active === true,
            createdAt: row.time_created,
          },
        ]
      })

    const stateFor = Effect.fn("CredentialQuota.state")(function* (
      rows: ReadonlyArray<typeof CredentialTable.$inferSelect>,
      now: number,
    ) {
      const ids = rows.map((row) => row.id)
      if (ids.length === 0)
        return {
          limits: new Map<string, CredentialQuotaLimit>(),
          usage: new Map<string, { requests: number; tokens: number; cost: number }>(),
          blockedUntil: new Map<string, number>(),
        }
      const limits = yield* db
        .select()
        .from(CredentialLimitTable)
        .where(inArray(CredentialLimitTable.credential_id, ids))
        .all()
        .pipe(Effect.orDie)
      const usageRows = yield* db
        .select()
        .from(CredentialUsageTable)
        .where(and(eq(CredentialUsageTable.month, CredentialQuotaRouter.month(now)), inArray(CredentialUsageTable.credential_id, ids)))
        .all()
        .pipe(Effect.orDie)
      const blocks = yield* db
        .select()
        .from(CredentialBlockTable)
        .where(inArray(CredentialBlockTable.credential_id, ids))
        .all()
        .pipe(Effect.orDie)
      const usage = new Map<string, { requests: number; tokens: number; cost: number }>()
      for (const row of usageRows) {
        const current = usage.get(row.credential_id) ?? { requests: 0, tokens: 0, cost: 0 }
        usage.set(row.credential_id, {
          requests: current.requests + row.requests,
          tokens: current.tokens + row.tokens,
          cost: current.cost + row.cost,
        })
      }
      return {
        limits: new Map(limits.map((row) => [row.credential_id, { metric: row.metric, amount: row.amount }])),
        usage,
        blockedUntil: new Map(blocks.map((row) => [row.credential_id, row.until])),
      }
    })

    const choose = Effect.fn("CredentialQuota.choose")(function* (integrationID: Integration.ID) {
      const rows = yield* rowsFor(integrationID)
      const accounts = candidates(rows)
      if (!CredentialQuotaRouter.rotates(integrationID, accounts)) return { mode: "passthrough" as const }
      const now = yield* Clock.currentTimeMillis
      const exclude = yield* Excluded
      const state = yield* stateFor(rows, now)
      const selected = CredentialQuotaRouter.select({
        accounts,
        limits: state.limits,
        usage: state.usage,
        blockedUntil: state.blockedUntil,
        exclude,
        now,
      })
      if (!selected) return { mode: "exhausted" as const }
      const row = rows.find((item) => item.id === selected.id)
      if (!row) return { mode: "exhausted" as const }
      if (accounts.length > 1)
        yield* Effect.logInfo("credential selected", {
          credentialID: row.id,
          label: row.label,
          integrationID,
        })
      return { mode: "selected" as const, id: row.id, label: row.label, value: row.value }
    })

    const writeSnapshot = Effect.fn("CredentialQuota.writeSnapshot")(function* (input: {
      readonly credentialID: Credential.ID
      readonly catalog: readonly QuotaCatalogModel[] | null
      readonly credit: QuotaCredit | undefined
      readonly error: string | null
    }) {
      const now = yield* Clock.currentTimeMillis
      const catalog = input.catalog === null ? null : [...input.catalog]
      const credit = {
        credit_limit: input.credit?.limit ?? null,
        credit_remaining: input.credit?.remaining ?? null,
        credit_usage: input.credit?.usage ?? null,
      }
      yield* db
        .insert(CredentialSnapshotTable)
        .values({
          credential_id: input.credentialID,
          observed_at: now,
          catalog,
          ...credit,
          error: input.error,
        })
        .onConflictDoUpdate({
          target: CredentialSnapshotTable.credential_id,
          set: input.error
            ? { observed_at: now, error: input.error }
            : { observed_at: now, catalog, ...credit, error: null },
        })
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({
      choose,
      rotates: Effect.fn("CredentialQuota.rotates")(function* (integrationID) {
        return CredentialQuotaRouter.rotates(integrationID, candidates(yield* rowsFor(integrationID)))
      }),
      block: Effect.fn("CredentialQuota.block")(function* (id, retryAfterMs) {
        const now = yield* Clock.currentTimeMillis
        const until = CredentialQuotaRouter.blockUntil(now, retryAfterMs)
        yield* db
          .insert(CredentialBlockTable)
          .values({ credential_id: id, until })
          .onConflictDoUpdate({ target: CredentialBlockTable.credential_id, set: { until } })
          .run()
          .pipe(Effect.orDie)
      }),
      clearBlock: Effect.fn("CredentialQuota.clearBlock")(function* (id) {
        const row = yield* db
          .select({ id: CredentialTable.id })
          .from(CredentialTable)
          .where(eq(CredentialTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new MissingError({ credentialID: id })
        yield* db.delete(CredentialBlockTable).where(eq(CredentialBlockTable.credential_id, id)).run().pipe(Effect.orDie)
      }),
      setLimit: Effect.fn("CredentialQuota.setLimit")(function* (id, limit) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!row?.integration_id) return yield* new MissingError({ credentialID: id })
        if (limit === null) {
          yield* db
            .delete(CredentialLimitTable)
            .where(eq(CredentialLimitTable.credential_id, id))
            .run()
            .pipe(Effect.orDie)
          return
        }
        if (limit.metric === "usd" && row.value.type !== "key")
          return yield* new RejectedLimitError({
            credentialID: id,
            message: "Dollar limits are only available for API keys",
          })
        const accounts = candidates(yield* rowsFor(row.integration_id))
        if (!CredentialQuotaRouter.rotates(row.integration_id, accounts))
          return yield* new RejectedLimitError({
            credentialID: id,
            message: "This provider cannot track a local quota limit",
          })
        yield* db
          .insert(CredentialLimitTable)
          .values({ credential_id: id, metric: limit.metric, amount: limit.amount })
          .onConflictDoUpdate({
            target: CredentialLimitTable.credential_id,
            set: { metric: limit.metric, amount: limit.amount },
          })
          .run()
          .pipe(Effect.orDie)
      }),
      record: Effect.fn("CredentialQuota.record")(function* (input) {
        const requests = input.succeeded ? 1 : 0
        const tokens = tokenTotal(input.usage.tokens)
        if (requests === 0 && tokens === 0 && input.usage.cost === 0) return
        const now = yield* Clock.currentTimeMillis
        yield* db
          .insert(CredentialUsageTable)
          .values({
            credential_id: input.credentialID,
            month: CredentialQuotaRouter.month(now),
            provider_id: input.providerID,
            model_id: input.modelID,
            requests,
            tokens,
            cost: input.usage.cost,
          })
          .onConflictDoUpdate({
            target: [
              CredentialUsageTable.credential_id,
              CredentialUsageTable.month,
              CredentialUsageTable.provider_id,
              CredentialUsageTable.model_id,
            ],
            set: {
              requests: sql`${CredentialUsageTable.requests} + ${requests}`,
              tokens: sql`${CredentialUsageTable.tokens} + ${tokens}`,
              cost: sql`${CredentialUsageTable.cost} + ${input.usage.cost}`,
            },
          })
          .run()
          .pipe(Effect.orDie)
      }),
      observe: Effect.fn("CredentialQuota.observe")(function* (input) {
        const limit = definedMap(input.window.limit)
        const remaining = definedMap(input.window.remaining)
        const reset = definedMap(input.window.reset)
        if (!limit && !remaining && !reset) return
        const now = yield* Clock.currentTimeMillis
        yield* db
          .insert(CredentialWindowTable)
          .values({
            credential_id: input.credentialID,
            provider_id: input.providerID,
            model_id: input.modelID,
            observed_at: now,
            limit: limit ?? null,
            remaining: remaining ?? null,
            reset: reset ?? null,
          })
          .onConflictDoUpdate({
            target: [
              CredentialWindowTable.credential_id,
              CredentialWindowTable.provider_id,
              CredentialWindowTable.model_id,
            ],
            set: {
              observed_at: now,
              limit: limit ?? null,
              remaining: remaining ?? null,
              reset: reset ?? null,
            },
          })
          .run()
          .pipe(Effect.orDie)
      }),
      refresh: Effect.fn("CredentialQuota.refresh")(function* () {
        const rows = yield* db.select().from(CredentialTable).all().pipe(Effect.orDie)
        yield* Effect.forEach(
          rows,
          (row) =>
            Effect.gen(function* () {
              if (row.value.type !== "key") return
              if (row.integration_id === "google") {
                const result = yield* Effect.result(readGoogle(row.value.key))
                if (Result.isFailure(result)) {
                  yield* writeSnapshot({
                    credentialID: row.id,
                    catalog: null,
                    credit: undefined,
                    error: result.failure.message,
                  })
                  return
                }
                yield* writeSnapshot({
                  credentialID: row.id,
                  catalog: result.success,
                  credit: undefined,
                  error: null,
                })
                return
              }
              if (row.integration_id !== "openrouter") return
              const result = yield* Effect.result(readOpenRouter(row.value.key))
              if (Result.isFailure(result)) {
                yield* writeSnapshot({
                  credentialID: row.id,
                  catalog: null,
                  credit: undefined,
                  error: result.failure.message,
                })
                return
              }
              yield* writeSnapshot({
                credentialID: row.id,
                catalog: null,
                credit: result.success,
                error: null,
              })
            }),
          { concurrency: 4, discard: true },
        )
      }),
      report: Effect.fn("CredentialQuota.report")(function* () {
        const now = yield* Clock.currentTimeMillis
        const rows = yield* db.select().from(CredentialTable).all().pipe(Effect.orDie)
        const byIntegration = new Map<Integration.ID, typeof rows>()
        for (const row of rows) {
          if (!row.integration_id) continue
          const group = byIntegration.get(row.integration_id) ?? []
          group.push(row)
          byIntegration.set(row.integration_id, group)
        }
        const providers = []
        for (const [integrationID, group] of [...byIntegration].sort((a, b) => a[0].localeCompare(b[0]))) {
          const state = yield* stateFor(group, now)
          const ids = group.map((row) => row.id)
          const models = yield* db
            .select()
            .from(CredentialUsageTable)
            .where(
              and(
                eq(CredentialUsageTable.month, CredentialQuotaRouter.month(now)),
                inArray(CredentialUsageTable.credential_id, ids),
              ),
            )
            .all()
            .pipe(Effect.orDie)
          const windows = yield* db
            .select()
            .from(CredentialWindowTable)
            .where(inArray(CredentialWindowTable.credential_id, ids))
            .all()
            .pipe(Effect.orDie)
          const snapshots = yield* db
            .select()
            .from(CredentialSnapshotTable)
            .where(inArray(CredentialSnapshotTable.credential_id, ids))
            .all()
            .pipe(Effect.orDie)
          const accounts = CredentialQuotaRouter.order(candidates(group)).flatMap((account) => {
            const limit = state.limits.get(account.id)
            const used = state.usage.get(account.id) ?? { requests: 0, tokens: 0, cost: 0 }
            const until = state.blockedUntil.get(account.id)
            const remaining = limit === undefined ? undefined : Math.max(0, limit.amount - usedAmount(limit.metric, used))
            const accountWindows = windows.filter((row) => row.credential_id === account.id)
            const latest = accountWindows.reduce<QuotaWindow | undefined>((current, row) => {
              const window = quotaWindow(row)
              if (!window) return current
              if (!current || window.observedAt > current.observedAt) return window
              return current
            }, undefined)
            const snapshot = snapshots.find((row) => row.credential_id === account.id)
            const catalog = snapshot?.catalog ?? undefined
            const credit = creditFrom(snapshot)
            return [
              {
                id: Credential.ID.make(account.id),
                label: account.label,
                ...(limit === undefined ? {} : { limit }),
                used,
                ...(remaining === undefined ? {} : { remaining }),
                ...(until !== undefined && until > now ? { blockedUntil: until } : {}),
                ...(latest ? { window: latest } : {}),
                ...(catalog ? { catalog } : {}),
                ...(credit ? { credit } : {}),
                ...(snapshot?.error ? { snapshotError: snapshot.error } : {}),
                models: accountModels(
                  integrationID,
                  models.filter((row) => row.credential_id === account.id),
                  accountWindows,
                  catalog ?? [],
                ),
              },
            ]
          })
          const combined = new Map<CredentialQuotaLimit["metric"], { used: number; limit: number }>()
          for (const account of accounts) {
            if (!account.limit) continue
            const current = combined.get(account.limit.metric) ?? { used: 0, limit: 0 }
            combined.set(account.limit.metric, {
              used: current.used + usedAmount(account.limit.metric, account.used),
              limit: current.limit + account.limit.amount,
            })
          }
          providers.push({
            integrationID,
            accounts,
            combined: [...combined].map(([metric, totals]) => ({
              metric,
              used: totals.used,
              limit: totals.limit,
              remaining: Math.max(0, totals.limit - totals.used),
            })),
          })
        }
        return { providers }
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
