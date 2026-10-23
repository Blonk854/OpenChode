import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { CredentialQuota } from "@opencode/core/credential/quota"
import { CredentialLimitTable, CredentialUsageTable } from "@opencode/core/credential/sql"
import { Database } from "@opencode/core/database/database"
import { Integration } from "@opencode/core/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Credential.node, CredentialQuota.node, Bus.node, Database.node])),
)

const usage = {
  tokens: { input: 2, output: 3, reasoning: 0, cache: { read: 1, write: 0 } },
  cost: 0.25,
}

describe("CredentialQuota", () => {
  it.effect("records usage, reports it without the secret, and deletes rows with the key", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const quota = yield* CredentialQuota.Service
      const db = (yield* Database.Service).db
      yield* TestClock.setTime(Date.UTC(2026, 9, 22))
      const integrationID = Integration.ID.make("anthropic")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "sk-secret-value" }),
      })
      yield* quota.setLimit(created.id, { metric: "usd", amount: 10 })
      yield* quota.record({
        credentialID: created.id,
        providerID: "anthropic",
        modelID: "claude",
        usage,
        succeeded: true,
      })
      yield* quota.record({
        credentialID: created.id,
        providerID: "anthropic",
        modelID: "claude",
        usage,
        succeeded: false,
      })
      const report = yield* quota.report()
      const encoded = JSON.stringify(report)
      expect(encoded).not.toContain("sk-secret-value")
      expect(report.providers).toEqual([
        expect.objectContaining({
          integrationID,
          combined: [{ metric: "usd", used: 0.5, limit: 10, remaining: 9.5 }],
          accounts: [
            expect.objectContaining({
              id: created.id,
              label: "Work",
              used: { requests: 1, tokens: 12, cost: 0.5 },
              remaining: 9.5,
              models: [expect.objectContaining({ modelID: "claude", requests: 1, tokens: 12, cost: 0.5 })],
            }),
          ],
        }),
      ])

      yield* credentials.remove(created.id)
      expect(yield* db.select().from(CredentialLimitTable).all()).toEqual([])
      expect(yield* db.select().from(CredentialUsageTable).where(eq(CredentialUsageTable.credential_id, created.id)).all()).toEqual([])
    }),
  )

  it.effect("stores a rate-limit window and leaves the secret out of the report", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const quota = yield* CredentialQuota.Service
      yield* TestClock.setTime(Date.UTC(2026, 9, 23, 12))
      const created = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        label: "Primary",
        value: Credential.Key.make({ type: "key", key: "sk-secret-value" }),
      })
      yield* quota.record({
        credentialID: created.id,
        providerID: "openai",
        modelID: "gpt-5",
        usage,
        succeeded: true,
      })
      yield* quota.observe({
        credentialID: created.id,
        providerID: "openai",
        modelID: "gpt-5",
        window: {
          limit: { requests: "60" },
          remaining: { requests: "59" },
          reset: { requests: "6s" },
        },
      })
      const report = yield* quota.report()
      expect(JSON.stringify(report)).not.toContain("sk-secret-value")
      const account = report.providers[0]?.accounts[0]
      expect(account?.window).toEqual({
        limit: { requests: "60" },
        remaining: { requests: "59" },
        reset: { requests: "6s" },
        observedAt: Date.UTC(2026, 9, 23, 12),
      })
      expect(account?.models[0]?.window).toEqual(account?.window)
    }),
  )

  it.effect("rejects a dollar limit on an unsupported provider", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const quota = yield* CredentialQuota.Service
      const created = yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        label: "Copilot",
        value: Credential.Key.make({ type: "key", key: "token" }),
      })
      const error = yield* quota.setLimit(created.id, { metric: "usd", amount: 5 }).pipe(Effect.flip)
      expect(error._tag).toBe("CredentialQuota.RejectedLimitError")
    }),
  )
})
