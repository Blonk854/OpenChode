import { describe, expect, test } from "bun:test"
import { CredentialQuotaRouter } from "@opencode/core/credential/quota-router"

const key = (id: string, createdAt: number, active = false) => ({
  id,
  label: id,
  type: "key" as const,
  active,
  createdAt,
})

describe("CredentialQuotaRouter", () => {
  test("orders the active key first, then creation time, then id", () => {
    expect(CredentialQuotaRouter.order([key("b", 2), key("a", 1), key("c", 1, true)]).map((account) => account.id)).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  test("uses the newest key when none is active", () => {
    expect(CredentialQuotaRouter.selectedID([key("a", 1), key("b", 2), key("c", 2)])).toBe("c")
  })

  test("skips a key that has used its limit and a key that is blocked", () => {
    const now = Date.UTC(2026, 9, 22)
    const accounts = [key("active", 1, true), key("limited", 2), key("open", 3)]
    const selected = CredentialQuotaRouter.select({
      accounts,
      limits: new Map([
        ["active", { metric: "requests", amount: 1 }],
        ["limited", { metric: "tokens", amount: 10 }],
      ]),
      usage: new Map([
        ["active", { requests: 1, tokens: 0, cost: 0 }],
        ["limited", { requests: 0, tokens: 10, cost: 0 }],
      ]),
      blockedUntil: new Map([["open", now + 1]]),
      exclude: new Set(),
      now,
    })
    expect(selected).toBeUndefined()
  })

  test("keeps a key with no limit and skips keys already tried", () => {
    const selected = CredentialQuotaRouter.select({
      accounts: [key("first", 1, true), key("second", 2)],
      limits: new Map(),
      usage: new Map(),
      blockedUntil: new Map(),
      exclude: new Set(["first"]),
      now: 0,
    })
    expect(selected?.id).toBe("second")
  })

  test("does not rotate oauth accounts or providers that cache the active connection", () => {
    const oauth = { ...key("oauth", 1, true), type: "oauth" as const }
    expect(CredentialQuotaRouter.rotates("anthropic", [key("a", 1, true), oauth])).toBe(false)
    expect(CredentialQuotaRouter.rotates("openai", [key("a", 1), key("b", 2)])).toBe(true)
    expect(CredentialQuotaRouter.rotates("openai", [key("a", 1), oauth])).toBe(false)
    expect(CredentialQuotaRouter.rotates("github-copilot", [key("a", 1), key("b", 2)])).toBe(false)
    expect(CredentialQuotaRouter.rotates("anthropic", [])).toBe(false)
  })

  test("blocks until retry-after or the end of the month, with an hour when no time is given", () => {
    const now = Date.UTC(2026, 9, 22, 12)
    expect(CredentialQuotaRouter.blockUntil(now, 60_000)).toBe(now + 60_000)
    expect(CredentialQuotaRouter.blockUntil(now, undefined)).toBe(now + 60 * 60 * 1000)
    const late = Date.UTC(2026, 10, 1) - 60_000
    expect(CredentialQuotaRouter.blockUntil(late, undefined)).toBe(Date.UTC(2026, 10, 1))
    expect(CredentialQuotaRouter.month(now)).toBe("2026-10")
  })
})
