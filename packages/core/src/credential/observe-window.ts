import { Effect, Exit } from "effect"
import { RateLimitObservation, type HttpRateLimitDetails, type RateLimitSlot } from "@opencode/ai"
import type { Credential } from "@opencode/schema/credential"
import type { CredentialQuota } from "./quota.js"

export const observeWindow = <A, E, R, R2>(
  effect: Effect.Effect<A, E, R>,
  save: (details: HttpRateLimitDetails) => Effect.Effect<void, unknown, R2>,
) =>
  Effect.gen(function* () {
    const slot: RateLimitSlot = {}
    const exit = yield* Effect.exit(effect.pipe(Effect.provideService(RateLimitObservation, slot)))
    if (slot.current) yield* save(slot.current).pipe(Effect.ignore)
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
    return exit.value
  })

export const saveObserved =
  (
    quota: CredentialQuota.Interface,
    model: {
      readonly credential?: { readonly id: Credential.ID } | undefined
      readonly ref: { readonly providerID: string; readonly id: string }
    },
  ) =>
  (details: HttpRateLimitDetails) => {
    const credential = model.credential
    if (!credential) return Effect.void
    return quota.observe({
      credentialID: credential.id,
      providerID: model.ref.providerID,
      modelID: model.ref.id,
      window: details,
    })
  }
