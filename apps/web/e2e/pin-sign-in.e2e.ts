import type { APIRequestContext, Page } from "@playwright/test";
import { e2eStore } from "./environment.ts";
import { addProduct, attachScreens, registerDevice, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * `core-foundation` slice 15: PIN sign-in on a registered device (flows 12–14). The browser
 * cannot start offline (no service worker), so the journey loads the app online, registers it,
 * and goes offline; the Windows app started with no network is the manual check recorded in the
 * slice notes.
 */

const CASHIER = { name: "نور", pin: "2580" };
const SUPERVISOR = { name: "كريم", pin: "7391" };

/**
 * A section cashier and an accountant with a PIN and no password — they sign in only by PIN on
 * a registered device (rule 19) — added through the API as the store's owner would.
 */
async function addPinUsers(request: APIRequestContext): Promise<void> {
  const store = e2eStore();
  const signedIn = await request.post("/api/v1/access/login", {
    data: { storeCode: store.storeCode, login: store.login, password: store.password },
  });
  expect(signedIn.status()).toBe(200);
  const { token } = (await signedIn.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const roles = (await (await request.get("/api/v1/access/roles", { headers })).json()) as {
    items: { id: string; template: string | null }[];
  };
  const roleOf = (template: string) => roles.items.find((role) => role.template === template)?.id;
  for (const [user, template] of [
    [CASHIER, "sectionCashier"],
    [SUPERVISOR, "accountant"],
  ] as const) {
    const created = await request.post("/api/v1/access/users", {
      headers,
      data: { name: user.name, roleId: roleOf(template), departmentScope: "all", pin: user.pin },
    });
    expect(created.status()).toBe(201);
  }
}

/** The PIN screen's name tile of `name`, from the keyboard. */
async function pickTile(page: Page, name: string, list = "المستخدمون على هذا الجهاز") {
  const tile = page
    .getByRole("list", { name: list })
    .getByRole("button", { name: new RegExp(name) });
  await tabTo(page, tile, 40);
  await page.keyboard.press("Enter");
}

/** Types a PIN into the focused pad and sends it with Enter. */
async function typePin(page: Page, forWhom: string, pin: string) {
  await expect(page.getByLabel(forWhom)).toBeFocused();
  await page.keyboard.type(pin);
  await page.keyboard.press("Enter");
}

/** Switches user from the top bar's menu: the device returns to its PIN screen. */
async function switchUser(page: Page, userName: string) {
  const button = page.getByRole("banner").getByRole("button", { name: new RegExp(userName) });
  await tabTo(page, button, 80);
  await page.keyboard.press("Enter");
  const target = page.getByRole("menu").getByRole("menuitem", { name: "تبديل المستخدم" });
  for (let presses = 0; presses < 5; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pin/);
}

test("keyboard only, offline: the PIN screen signs in PIN-only users, sells, locks a name out after five wrong PINs, a supervisor unlocks, auto-lock keeps the cart", async ({
  page,
  context,
  request,
}, testInfo) => {
  await addPinUsers(request);
  // The page's clock is Playwright's, so five idle minutes pass in a moment (rule 24).
  await page.clock.install();
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const barcode = `627${String(Date.now()).slice(-10)}`;
  await addProduct(page, "غطاء هاتف", barcode, "7.5");
  await registerDevice(page);
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  // The round brought the product and the signed bundle with the users' PIN verifiers.
  await expect(page.getByRole("button", { name: "أضف غطاء هاتف إلى السلة" })).toBeVisible();
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");

  // Offline from here: the PIN is checked on the device against the bundle.
  await context.setOffline(true);
  await expect(sync.getByTestId("sync-phase")).toHaveText("غير متصل");
  await switchUser(page, "سامر");
  await expect(page.getByRole("heading", { level: 1, name: "من يستخدم الجهاز؟" })).toBeVisible();
  await expectAccessible(page);
  await attachScreens(page, testInfo, "pin-tiles");

  // Flow 12: the name, then the PIN — a PIN-only cashier signs in and sells.
  await pickTile(page, CASHIER.name);
  await expectAccessible(page);
  await attachScreens(page, testInfo, "pin-pad");
  await typePin(page, `الرمز السري لـ ${CASHIER.name}`, CASHIER.pin);
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole("banner").getByRole("button", { name: /نور/ })).toBeVisible();
  const scan = page.getByLabel("الباركود");
  await expect(scan).toBeFocused();
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");
  const cart = page.getByRole("grid", { name: "السلة" });
  await expect(cart.getByRole("row").filter({ hasText: "غطاء هاتف" })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "إتمام البيع نقدًا" }), 40);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("recorded-number")).toHaveText(/-INV-000001$/);

  // Flow 13: five wrong PINs lock the name on this device; a supervisor unlocks it.
  await switchUser(page, CASHIER.name);
  await pickTile(page, CASHIER.name);
  const forCashier = `الرمز السري لـ ${CASHIER.name}`;
  for (const left of ["بقيت 4 محاولات", "بقيت 3 محاولات", "بقيت محاولتان", "بقيت محاولة واحدة"]) {
    await typePin(page, forCashier, "1470");
    await expect(page.getByRole("alert")).toContainText(left);
  }
  await typePin(page, forCashier, "1470");
  await expect(page.getByRole("alert")).toContainText(
    `أُقفل ${CASHIER.name} على هذا الجهاز بعد خمس محاولات خاطئة.`,
  );
  // Locked: even the right PIN is not checked.
  await typePin(page, forCashier, CASHIER.pin);
  await expect(page.getByRole("alert")).toContainText(`${CASHIER.name} مقفل على هذا الجهاز`);
  await expectAccessible(page);
  await attachScreens(page, testInfo, "pin-locked");
  await tabTo(page, page.getByRole("button", { name: "فتح القفل بواسطة مشرف" }));
  await page.keyboard.press("Enter");
  await pickTile(page, SUPERVISOR.name, "المشرفون على هذا الجهاز");
  await typePin(page, `رمز المشرف ${SUPERVISOR.name}`, SUPERVISOR.pin);
  await expect(page.getByRole("status")).toHaveText(`فُتح قفل ${CASHIER.name}. يمكنه الدخول الآن.`);
  await typePin(page, forCashier, CASHIER.pin);
  await expect(page).toHaveURL(/\/pos$/);

  // Back online, the first screen that needs the server asks for the PIN again (rule 25).
  await context.setOffline(false);
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await tabTo(page, page.getByRole("navigation").getByRole("link", { name: "المنتجات" }), 40);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "أدخل رمزك للاتصال بالخادم" }),
  ).toBeVisible();
  await typePin(page, forCashier, CASHIER.pin);
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("main")).toContainText("غطاء هاتف");

  // Flow 14: five idle minutes return to the PIN screen, and the cart is where it was.
  await page.getByRole("link", { name: "البيع" }).click();
  await expect(scan).toBeFocused();
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");
  await expect(cart.getByRole("row").filter({ hasText: "غطاء هاتف" })).toBeVisible();
  await page.clock.fastForward("05:10");
  await expect(page).toHaveURL(/\/pin/);
  await pickTile(page, CASHIER.name);
  await typePin(page, forCashier, CASHIER.pin);
  await expect(page).toHaveURL(/\/pos$/);
  await expect(cart.getByRole("row").filter({ hasText: "غطاء هاتف" })).toBeVisible();
});
