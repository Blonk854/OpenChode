import { ChodeIntro } from "@/brand/intro"
import "./wordmark.css"

export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px]"
    >
      <ChodeIntro class="mx-auto block w-full max-w-[280px]" />
    </div>
  )
}
