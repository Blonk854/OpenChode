import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261023174712_credential_window",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`credential_snapshot\` (
          \`credential_id\` text PRIMARY KEY,
          \`observed_at\` integer NOT NULL,
          \`catalog\` text,
          \`credit_limit\` real,
          \`credit_remaining\` real,
          \`credit_usage\` real,
          \`error\` text,
          CONSTRAINT \`fk_credential_snapshot_credential_id_credential_id_fk\` FOREIGN KEY (\`credential_id\`) REFERENCES \`credential\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential_window\` (
          \`credential_id\` text NOT NULL,
          \`provider_id\` text NOT NULL,
          \`model_id\` text NOT NULL,
          \`observed_at\` integer NOT NULL,
          \`limit\` text,
          \`remaining\` text,
          \`reset\` text,
          CONSTRAINT \`credential_window_pk\` PRIMARY KEY(\`credential_id\`, \`provider_id\`, \`model_id\`),
          CONSTRAINT \`fk_credential_window_credential_id_credential_id_fk\` FOREIGN KEY (\`credential_id\`) REFERENCES \`credential\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
