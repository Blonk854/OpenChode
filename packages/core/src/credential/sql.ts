import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { CredentialQuota } from "@opencode/schema/credential-quota"
import { Timestamps } from "../database/schema.sql.js"
import type { Credential } from "../credential.js"

export const CredentialTable = sqliteTable("credential", {
  id: text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<Credential.Info["integrationID"]>(),
  label: text().notNull(),
  value: text({ mode: "json" }).$type<Credential.Value>().notNull(),
  connector_id: text(),
  method_id: text(),
  active: integer({ mode: "boolean" }),
  ...Timestamps,
})

export const CredentialLimitTable = sqliteTable("credential_limit", {
  credential_id: text()
    .$type<Credential.ID>()
    .primaryKey()
    .references(() => CredentialTable.id, { onDelete: "cascade" }),
  metric: text().$type<CredentialQuota.Metric>().notNull(),
  amount: real().notNull(),
})

export const CredentialUsageTable = sqliteTable(
  "credential_usage",
  {
    credential_id: text()
      .$type<Credential.ID>()
      .notNull()
      .references(() => CredentialTable.id, { onDelete: "cascade" }),
    month: text().notNull(),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    requests: integer().notNull().default(0),
    tokens: integer().notNull().default(0),
    cost: real().notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.credential_id, table.month, table.provider_id, table.model_id] })],
)

export const CredentialBlockTable = sqliteTable("credential_block", {
  credential_id: text()
    .$type<Credential.ID>()
    .primaryKey()
    .references(() => CredentialTable.id, { onDelete: "cascade" }),
  until: integer().notNull(),
})

export const CredentialWindowTable = sqliteTable(
  "credential_window",
  {
    credential_id: text()
      .$type<Credential.ID>()
      .notNull()
      .references(() => CredentialTable.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    observed_at: integer().notNull(),
    limit: text({ mode: "json" }).$type<Record<string, string> | null>(),
    remaining: text({ mode: "json" }).$type<Record<string, string> | null>(),
    reset: text({ mode: "json" }).$type<Record<string, string> | null>(),
  },
  (table) => [primaryKey({ columns: [table.credential_id, table.provider_id, table.model_id] })],
)

export const CredentialSnapshotTable = sqliteTable("credential_snapshot", {
  credential_id: text()
    .$type<Credential.ID>()
    .primaryKey()
    .references(() => CredentialTable.id, { onDelete: "cascade" }),
  observed_at: integer().notNull(),
  catalog: text({ mode: "json" }).$type<CredentialQuota.CatalogModel[] | null>(),
  credit_limit: real(),
  credit_remaining: real(),
  credit_usage: real(),
  error: text(),
})
