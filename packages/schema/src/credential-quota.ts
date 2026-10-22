export * as CredentialQuota from "./credential-quota.js"

import { Schema } from "effect"
import { ID as CredentialID } from "./credential.js"
import { IntegrationID } from "./integration-id.js"
import { NonNegativeInt, optional } from "./schema.js"

/**
 * Providers whose plugins read the active connection themselves. A step key
 * injected into model resolution would not switch their headers or org policy.
 */
export const UnsupportedIntegrationIDs = [
  "azure",
  "chatgpt",
  "digitalocean",
  "github-copilot",
  "gitlab",
  "google-vertex",
  "modal",
  "opencode",
  "snowflake-cortex",
] as const

export const Metric = Schema.Literals(["requests", "tokens", "usd"]).annotate({
  identifier: "CredentialQuota.Metric",
})
export type Metric = typeof Metric.Type

export interface Limit extends Schema.Schema.Type<typeof Limit> {}
export const Limit = Schema.Struct({
  metric: Metric,
  amount: Schema.Finite.check(Schema.isGreaterThan(0)),
}).annotate({ identifier: "CredentialQuota.Limit" })

export interface Usage extends Schema.Schema.Type<typeof Usage> {}
export const Usage = Schema.Struct({
  requests: NonNegativeInt,
  tokens: NonNegativeInt,
  cost: Schema.Finite,
}).annotate({ identifier: "CredentialQuota.Usage" })

export interface ModelUsage extends Schema.Schema.Type<typeof ModelUsage> {}
export const ModelUsage = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  requests: NonNegativeInt,
  tokens: NonNegativeInt,
  cost: Schema.Finite,
}).annotate({ identifier: "CredentialQuota.ModelUsage" })

export interface Account extends Schema.Schema.Type<typeof Account> {}
export const Account = Schema.Struct({
  id: CredentialID,
  label: Schema.String,
  limit: optional(Limit),
  used: Usage,
  remaining: optional(Schema.Finite),
  blockedUntil: optional(Schema.Finite),
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "CredentialQuota.Account" })

export interface Combined extends Schema.Schema.Type<typeof Combined> {}
export const Combined = Schema.Struct({
  metric: Metric,
  used: Schema.Finite,
  limit: Schema.Finite,
  remaining: Schema.Finite,
}).annotate({ identifier: "CredentialQuota.Combined" })

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  integrationID: IntegrationID,
  accounts: Schema.Array(Account),
  combined: Schema.Array(Combined),
}).annotate({ identifier: "CredentialQuota.Provider" })

export interface Report extends Schema.Schema.Type<typeof Report> {}
export const Report = Schema.Struct({
  providers: Schema.Array(Provider),
}).annotate({ identifier: "CredentialQuota.Report" })
