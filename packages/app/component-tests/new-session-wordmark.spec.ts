import { expect, story } from "../../storybook/playwright/story"

for (const theme of ["light", "dark"]) {
  story(`plays the intro once (${theme})`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const component = await mount("app-new-session-wordmark--reveal", { globals: { theme } })
    const video = component.locator('[data-component="new-session-wordmark"] video')
    await expect(video).toHaveAttribute("src", /chode-intro/)
    await expect(video).toHaveJSProperty("muted", true)
    await expect(video).toHaveJSProperty("loop", false)
    await expect(video).toHaveJSProperty("autoplay", true)
  })

  story(`holds the intro still when motion is reduced (${theme})`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const component = await mount("app-new-session-wordmark--reveal", { globals: { theme } })
    const video = component.locator('[data-component="new-session-wordmark"] video')
    await expect(video).toHaveJSProperty("autoplay", false)
    await expect(video).toHaveJSProperty("paused", true)
  })
}
