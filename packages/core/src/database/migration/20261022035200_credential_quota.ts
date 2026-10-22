import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261022035200_credential_quota",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`credential_limit\` (
          \`credential_id\` text PRIMARY KEY,
          \`metric\` text NOT NULL,
          \`amount\` real NOT NULL,
          CONSTRAINT \`fk_credential_limit_credential_id_credential_id_fk\` FOREIGN KEY (\`credential_id\`) REFERENCES \`credential\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential_usage\` (
          \`credential_id\` text NOT NULL,
          \`month\` text NOT NULL,
          \`provider_id\` text NOT NULL,
          \`model_id\` text NOT NULL,
          \`requests\` integer DEFAULT 0 NOT NULL,
          \`tokens\` integer DEFAULT 0 NOT NULL,
          \`cost\` real DEFAULT 0 NOT NULL,
          CONSTRAINT \`credential_usage_pk\` PRIMARY KEY(\`credential_id\`, \`month\`, \`provider_id\`, \`model_id\`),
          CONSTRAINT \`fk_credential_usage_credential_id_credential_id_fk\` FOREIGN KEY (\`credential_id\`) REFERENCES \`credential\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential_block\` (
          \`credential_id\` text PRIMARY KEY,
          \`until\` integer NOT NULL,
          CONSTRAINT \`fk_credential_block_credential_id_credential_id_fk\` FOREIGN KEY (\`credential_id\`) REFERENCES \`credential\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
