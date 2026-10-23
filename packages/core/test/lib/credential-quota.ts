import { CredentialQuota } from "@opencode/core/credential/quota"
import { Effect, Layer } from "effect"

/** Keeps resolver tests on the active connection, the behavior from before quota selection. */
export const passthrough = Layer.mock(CredentialQuota.Service, {
  choose: () => Effect.succeed({ mode: "passthrough" as const }),
  rotates: () => Effect.succeed(false),
  block: () => Effect.void,
  clearBlock: () => Effect.void,
  setLimit: () => Effect.void,
  record: () => Effect.void,
  observe: () => Effect.void,
  refresh: () => Effect.void,
  report: () => Effect.succeed({ providers: [] }),
})
