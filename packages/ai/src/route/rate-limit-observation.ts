import { Context } from "effect"
import type { HttpRateLimitDetails } from "../schema/errors.js"

export interface RateLimitSlot {
  current?: HttpRateLimitDetails
}

export const RateLimitObservation = Context.Reference<RateLimitSlot>("@opencode/ai/RateLimitObservation", {
  defaultValue: () => ({}),
})
