import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { e2eStore } from "./environment.ts";
import { expectAccessible } from "./test.ts";

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

/** Signs in with the keyboard alone, from the start page (the store's owner by default). */
export async function signIn(
  page: Page,
  password = e2eStore().password,
  login = e2eStore().login,
): Promise<void> {
  const store = e2eStore();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("رمز المتجر")).toBeFocused();
  await page.keyboard.type(store.storeCode);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("اسم الدخول")).toBeFocused();
  await page.keyboard.type(login);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("كلمة المرور")).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
}

/** Screenshots of a screen in both themes, attached to the report for the slice review. */
export async function attachScreens(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // No colour transition between the themes: axe measures the final colours.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    await expectAccessible(page);
    const body = await page.screenshot();
    await testInfo.attach(`${name}-${theme}`, { body, contentType: "image/png" });
    // For the slice report: `MUSTAWFI_E2E_SCREENSHOTS=<dir>` keeps them after a passing run.
    const dir = process.env["MUSTAWFI_E2E_SCREENSHOTS"];
    if (dir !== undefined) writeFileSync(join(dir, `${name}-${theme}.png`), body);
  }
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });
}
