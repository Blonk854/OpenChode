export * as CredentialQuotaRouter from "./quota-router.js"

import { UnsupportedIntegrationIDs, type CredentialQuota } from "@opencode/schema/credential-quota"

const HOUR = 60 * 60 * 1000

export interface Candidate {
  readonly id: string
  readonly label: string
  readonly type: "key" | "oauth" | "external"
  readonly active: boolean
  readonly createdAt: number
}

export interface LimitState {
  readonly metric: CredentialQuota.Metric
  readonly amount: number
}

export interface UsageState {
  readonly requests: number
  readonly tokens: number
  readonly cost: number
}

const unsupported = new Set<string>(UnsupportedIntegrationIDs)

/** True when every stored account is an API key and this provider does not cache the active connection. */
export const rotates = (integrationID: string, accounts: readonly Candidate[]) => {
  if (accounts.length === 0) return false
  if (unsupported.has(integrationID)) return false
  return accounts.every((account) => account.type === "key")
}

/** The account the product would use today: the active flag, or the newest row when none is flagged. */
export const selectedID = (accounts: readonly Candidate[]) => {
  if (accounts.length === 0) return
  return [...accounts].sort(storedOrder).at(-1)?.id
}

export const order = (accounts: readonly Candidate[]) => {
  const selected = selectedID(accounts)
  return [...accounts].sort((a, b) => {
    const rank = Number(a.id !== selected) - Number(b.id !== selected)
    if (rank !== 0) return rank
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  })
}

export const select = (input: {
  readonly accounts: readonly Candidate[]
  readonly limits: ReadonlyMap<string, LimitState>
  readonly usage: ReadonlyMap<string, UsageState>
  readonly blockedUntil: ReadonlyMap<string, number>
  readonly exclude: ReadonlySet<string>
  readonly now: number
}) =>
  order(input.accounts).find((account) => {
    if (input.exclude.has(account.id)) return false
    const until = input.blockedUntil.get(account.id)
    if (until !== undefined && until > input.now) return false
    const limit = input.limits.get(account.id)
    if (!limit) return true
    const usage = input.usage.get(account.id) ?? { requests: 0, tokens: 0, cost: 0 }
    if (limit.metric === "requests") return usage.requests < limit.amount
    if (limit.metric === "tokens") return usage.tokens < limit.amount
    return usage.cost < limit.amount
  })

export const month = (now: number) => {
  const date = new Date(now)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Block until the provider's retry time or the end of the UTC month, whichever is sooner. */
export const blockUntil = (now: number, retryAfterMs: number | undefined) => {
  const date = new Date(now)
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  const retry = retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : HOUR
  return Math.min(now + retry, monthEnd)
}

const storedOrder = (a: Candidate, b: Candidate) =>
  Number(a.active) - Number(b.active) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
