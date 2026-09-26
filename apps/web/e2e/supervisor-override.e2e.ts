import type { APIRequestContext } from "@playwright/test";
import { e2eStore } from "./environment.ts";
import {
  addProduct,
  attachScreens,
  pickTile,
  registerDevice,
  signIn,
  switchUser,
  tabTo,
  typePin,
} from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * `core-foundation` slice 16: a sale beyond the cashier's departments asks a supervisor, who
 * approves it with their PIN on the device, offline (flow 15, rule 18).
 */

const CASHIER = { name: "جود", pin: "3690" };
const SUPERVISOR = { name: "وسيم", pin: "8024" };

/**
 * Two departments, a section cashier listing both — so their sales go under the store's default
 * department, outside their scope (rule 32) — and a section cashier of every department who can
 * approve, both PIN-only, added through the API as the owner would.
 */
async function addStaff(request: APIRequestContext): Promise<void> {
  const store = e2eStore();
  const signedIn = await request.post("/api/v1/access/login", {
    data: { storeCode: store.storeCode, login: store.login, password: store.password },
  });
  expect(signedIn.status()).toBe(200);
  const { token } = (await signedIn.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const departments: string[] = [];
  for (const name of ["الشحن", "الإصلاح"]) {
    const added = await request.post("/api/v1/organization/departments", {
      headers,
      data: { name: `${name} ${String(Date.now()).slice(-6)}` },
    });
    expect(added.status()).toBe(201);
    departments.push(((await added.json()) as { id: string }).id);
  }
  const roles = (await (await request.get("/api/v1/access/roles", { headers })).json()) as {
    items: { id: string; template: string | null }[];
  };
  const cashierRole = roles.items.find((role) => role.template === "sectionCashier")?.id;
  for (const [user, scope] of [
    [CASHIER, { departmentScope: "listed", departments }],
    [SUPERVISOR, { departmentScope: "all" }],
  ] as const) {
    const created = await request.post("/api/v1/access/users", {
      headers,
      data: { name: user.name, roleId: cashierRole, pin: user.pin, ...scope },
    });
    expect(created.status()).toBe(201);
  }
}

test("keyboard only, offline: a sale outside the cashier's departments is approved by a supervisor's PIN", async ({
  page,
  context,
  request,
}, testInfo) => {
  await addStaff(request);
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const barcode = `628${String(Date.now()).slice(-10)}`;
  await addProduct(page, "شاحن سيارة", barcode, "12");
  await registerDevice(page);
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  // The round brought the product and the bundle with the staff, their roles, and scopes.
  await expect(page.getByRole("button", { name: "أضف شاحن سيارة إلى السلة" })).toBeVisible();
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");

  await context.setOffline(true);
  await expect(sync.getByTestId("sync-phase")).toHaveText("غير متصل");
  await switchUser(page, "سامر");
  await pickTile(page, CASHIER.name);
  await typePin(page, `الرمز السري لـ ${CASHIER.name}`, CASHIER.pin);
  await expect(page).toHaveURL(/\/pos$/);

  // The sale goes under the store's default department, outside the cashier's two.
  await expect(page.getByLabel("الباركود")).toBeFocused();
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");
  const cart = page.getByRole("grid", { name: "السلة" });
  await expect(cart.getByRole("row").filter({ hasText: "شاحن سيارة" })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "إتمام البيع نقدًا" }), 40);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "موافقة مشرف" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("لا يملك دورك إتمام هذا البيع.");
  // Only those whose role covers the sale are offered; the cashier is not their own supervisor.
  const supervisors = dialog.getByRole("list", { name: "المشرفون الذين يملكون الموافقة" });
  await expect(
    supervisors.getByRole("button", { name: new RegExp(SUPERVISOR.name) }),
  ).toBeVisible();
  await expect(supervisors.getByRole("button", { name: new RegExp(CASHIER.name) })).toHaveCount(0);
  await expectAccessible(page);
  await attachScreens(page, testInfo, "override-supervisors");
  await pickTile(page, SUPERVISOR.name, "المشرفون الذين يملكون الموافقة");

  // A wrong PIN counts against the supervisor and approves nothing.
  const forSupervisor = `رمز المشرف ${SUPERVISOR.name}`;
  await typePin(page, forSupervisor, "1470");
  await expect(dialog.getByRole("alert")).toContainText("الرمز غير صحيح");
  await expectAccessible(page);
  await attachScreens(page, testInfo, "override-pin");
  await typePin(page, forSupervisor, SUPERVISOR.pin);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("recorded-number")).toHaveText(/-INV-000001$/);
  await expect(cart.getByRole("row").filter({ hasText: "شاحن سيارة" })).toHaveCount(0);

  // Back online, the sale reaches the server with its override.
  await context.setOffline(false);
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  const recent = page.getByRole("grid", { name: "آخر فواتير هذا الجهاز" });
  await expect(recent.getByRole("row").filter({ hasText: "-INV-000001" })).toContainText(
    "وصلت إلى الخادم",
  );
});
