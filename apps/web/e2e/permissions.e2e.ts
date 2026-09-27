import { signIn } from "./steps.ts";
import { addCashier, CASHIER, createStore } from "./stores.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * QA slice 24 of `core-foundation`: what the role never allows is not shown (`screen-patterns.md`)
 * — not in the navigation, and not by its address either.
 */

const YEAR = 365 * 24 * 3_600_000;

test("keyboard only: a cashier opening an administration screen by its address is told the role does not allow it", async ({
  page,
  request,
}) => {
  const store = await createStore({ expiresAt: new Date(Date.now() + YEAR) });
  await addCashier(request, store);
  await signIn(page, CASHIER.password, CASHIER.login, store.storeCode);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await expect(navigation.getByRole("link", { name: "بيانات المتجر" })).toHaveCount(0);

  // The store profile by its address: no form to fill, the reason, and the way back.
  await page.goto("/admin/profile");
  await expect(page.getByRole("banner").getByRole("button", { name: /ليلى/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "لا يسمح لك دورك بفتح «بيانات المتجر»" }),
  ).toBeVisible();
  await expect(page.getByLabel("اسم المتجر (مطلوب)")).toHaveCount(0);
  const back = page.getByRole("button", { name: "الانتقال إلى «المنتجات»" });
  await expect(back).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/products$/);

  // The same for a list the cashier may not read, and for the departments, which every session
  // may read but only managers change: no «New» there.
  for (const [path, title] of [
    ["/invoices", "الفواتير"],
    ["/admin/departments", "الأقسام"],
    ["/admin/license", "الترخيص والباقة"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 2, name: `لا يسمح لك دورك بفتح «${title}»` }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /جديد/ })).toHaveCount(0);
  }
});
