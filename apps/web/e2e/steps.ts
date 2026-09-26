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
  storeCode = e2eStore().storeCode,
): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("رمز المتجر")).toBeFocused();
  await page.keyboard.type(storeCode);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("اسم الدخول")).toBeFocused();
  await page.keyboard.type(login);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("كلمة المرور")).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
}

/**
 * Opens the top bar's user menu from the keyboard (the button carries the user's name) and
 * picks `item`: Enter opens the menu on its first item, the down arrow moves.
 */
export async function chooseFromUserMenu(
  page: Page,
  userName: string,
  item: "حسابي" | "تسجيل الخروج",
  screens?: { readonly testInfo: TestInfo; readonly name: string },
): Promise<void> {
  const button = page.getByRole("banner").getByRole("button", { name: new RegExp(userName) });
  await tabTo(page, button, 80);
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expectAccessible(page);
  if (screens !== undefined) await attachScreens(page, screens.testInfo, screens.name);
  const target = menu.getByRole("menuitem", { name: item });
  for (let presses = 0; presses < 5; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
}

/** Signs out through the user menu, back to sign-in. */
export async function signOut(page: Page, userName: string): Promise<void> {
  await chooseFromUserMenu(page, userName, "تسجيل الخروج");
  await expect(page).toHaveURL(/\/login/);
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

/** Flow 3: the owner adds a product online, priced in the store's currency (SYP). */
export async function addProduct(page: Page, name: string, barcode: string, price: string) {
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByLabel("اسم المنتج").fill(name);
  await page.getByLabel("الباركود", { exact: true }).fill(barcode);
  await page.getByLabel("سعر البيع").fill(price);
  await page.getByRole("button", { name: "إضافة المنتج" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(`أُضيف المنتج «${name}»`);
}

/**
 * Flow 4: the owner issues a registration code on the devices screen and registers this
 * browser, as a companion, in the journey's store (the run's store by default).
 */
export async function registerDevice(
  page: Page,
  storeCode = e2eStore().storeCode,
): Promise<string> {
  await page.getByRole("link", { name: "الأجهزة" }).click();
  await page.getByRole("button", { name: /جهاز جديد/ }).click();
  await page.getByRole("button", { name: "إصدار رمز تسجيل" }).click();
  const code = page.getByTestId("registration-code");
  await expect(code).toHaveText(/^\S+$/);
  await expect(page.getByTestId("store-code")).toHaveText(storeCode);
  const registrationCode = (await code.textContent()) ?? "";
  await page.getByRole("link", { name: "تسجيل الجهاز" }).click();
  await page.getByLabel("رمز المتجر").fill(storeCode);
  await page.getByLabel("رمز التسجيل").fill(registrationCode);
  await page.getByLabel("اسم الجهاز").fill("الصندوق الرئيسي");
  await page.getByRole("button", { name: "تسجيل الجهاز" }).click();
  const prefix = page.getByTestId("device-prefix");
  await expect(prefix).toHaveText(/^[A-HJ-NP-Z2-9]{2}$/);
  // The browser is never the main POS (ADR-0019); the Windows app is.
  await expect(page.getByTestId("device-type")).toHaveText("جهاز مساعد");
  await expectAccessible(page);
  return (await prefix.textContent()) ?? "";
}

/**
 * On a registered device whose session ended (auto-lock, or the app opened after the idle time,
 * `core-foundation` rule 24): from its PIN screen to password sign-in, keyboard only — for an
 * owner who has no PIN.
 */
export async function signInAgainOnDevice(
  page: Page,
  password: string,
  login: string,
  storeCode: string,
): Promise<void> {
  await expect(page).toHaveURL(/\/pin/);
  await tabTo(page, page.getByRole("link", { name: "الدخول بكلمة المرور" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("رمز المتجر")).toBeFocused();
  await page.keyboard.type(storeCode);
  await page.keyboard.press("Tab");
  await page.keyboard.type(login);
  await page.keyboard.press("Tab");
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/products$/);
}
