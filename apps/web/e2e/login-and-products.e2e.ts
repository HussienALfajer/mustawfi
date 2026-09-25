import { expect, test } from "@playwright/test";
import { signIn, tabTo } from "./steps.ts";

test("renders right to left in Arabic", async ({ page }) => {
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  const form = await page.getByRole("form").evaluate((element) => getComputedStyle(element));
  expect(form.direction).toBe("rtl");
  // The screen's classes live in a module package: Tailwind must scan it (`@source`).
  expect(form.maxWidth).not.toBe("none");
});

test("reports a wrong password in words and stays on the sign-in page", async ({ page }) => {
  await signIn(page, "not the password");
  await expect(page.getByRole("alert")).toHaveText(
    "رمز المتجر أو اسم الدخول أو كلمة المرور غير صحيح",
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("keyboard only: sign in, add a product, see it listed, sign out", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("heading", { name: "المنتجات", level: 2 })).toBeVisible();

  const barcode = `629${String(Date.now()).slice(-10)}`;
  await tabTo(page, page.getByLabel("اسم المنتج"));
  await page.keyboard.type("شاحن سريع ٢٠ واط");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("الباركود", { exact: true })).toBeFocused();
  await page.keyboard.type(barcode);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("سعر البيع")).toBeFocused();
  await page.keyboard.type("١٢٫٥");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "ل.س" })).toBeFocused();
  // Right to left, the next option is to the left.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "$" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "إضافة المنتج" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "أُضيف المنتج «شاحن سريع ٢٠ واط»",
  );
  await expect(page.getByLabel("اسم المنتج")).toBeFocused();
  await expect(page.getByLabel("اسم المنتج")).toHaveValue("");
  const row = page.getByRole("row").filter({ hasText: barcode });
  await expect(row.getByRole("rowheader")).toHaveText("شاحن سريع ٢٠ واط");
  await expect(row.getByRole("gridcell").last()).toHaveText("12.50$");

  // The session is an HttpOnly cookie: it survives a reload and scripts cannot read it.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: barcode })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("mustawfi_session");

  await tabTo(page, page.getByRole("button", { name: "تسجيل الخروج" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login$/);
});

test("returns to sign-in when the session ends elsewhere", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  // Revoked behind the app's back (another tab signing out); the cached session is now stale.
  await page.evaluate(() => fetch("/api/v1/access/logout", { method: "POST" }));
  await tabTo(page, page.getByLabel("اسم المنتج"));
  await page.keyboard.type("منتج بلا جلسة");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
});

test("touch density gives every control a 48 px target", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    document.documentElement.dataset["density"] = "touch";
  });
  for (const control of [
    page.getByLabel("رمز المتجر"),
    page.getByLabel("كلمة المرور"),
    page.getByRole("button", { name: "دخول" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }
});
