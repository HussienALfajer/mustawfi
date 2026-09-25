import { expect, type Locator, type Page } from "@playwright/test";
import { e2eStore } from "./environment.ts";

/**
 * Keyboard only: `tabTo` presses Tab until the target has focus, as a cashier with a barcode
 * scanner and no mouse works.
 */
export async function tabTo(page: Page, target: Locator, limit = 25): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** Signs in with the keyboard alone, from the start page. */
export async function signIn(page: Page, password = e2eStore().password): Promise<void> {
  const store = e2eStore();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("رمز المتجر")).toBeFocused();
  await page.keyboard.type(store.storeCode);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("اسم الدخول")).toBeFocused();
  await page.keyboard.type(store.login);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("كلمة المرور")).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
}
