import { expect, type Locator, type Page } from "@playwright/test"

export const APP_READY_TIMEOUT = 30_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  await expectAppVisible(page.getByRole("heading", { name: title }))
}

// The "Introducing Tabs" onboarding toast (bottom-right, help-button.tsx)
// has no seen-state persistence yet (tracked as a TODO there) — it always
// renders on load and its video/text intercept pointer events for anything
// underneath it. Dismiss it before interacting with bottom-right UI.
export async function dismissTabsIntroToast(page: Page) {
  const dismiss = page.getByRole("button", { name: "Dismiss Tabs information" })
  if (await dismiss.isVisible({ timeout: 2_000 }).catch(() => false)) await dismiss.click()
}
