import { attachScreens, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

test("keyboard only: edit the store profile and add a department", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);

  // The side navigation groups the screens; administration is the owner's.
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await expect(navigation.getByRole("group", { name: "الإدارة" })).toBeVisible();
  await tabTo(page, navigation.getByRole("link", { name: "بيانات المتجر" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/profile$/);
  await expect(page.getByRole("heading", { name: "بيانات المتجر", level: 1 })).toBeVisible();

  // Enter moves to the next field; a wrong phone is said on the field; Ctrl+S saves.
  const name = page.getByLabel("اسم المتجر (مطلوب)");
  await tabTo(page, name);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("موبايلات الحلبي");
  await page.keyboard.press("Enter");
  const phone = page.getByLabel("الهاتف 1");
  await expect(phone).toBeFocused();
  await page.keyboard.type("هاتف");
  await page.keyboard.press("Control+S");
  await expect(phone).toHaveAccessibleDescription(/اكتب رقم الهاتف بالأرقام/);
  await expect(page.getByRole("status").filter({ hasText: "تغييرات غير محفوظة" })).toBeVisible();
  await phone.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("+963 11 222 3344");
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status").filter({ hasText: "حُفظت بيانات المتجر" })).toBeVisible();
  await attachScreens(page, testInfo, "store-profile");
  await page.reload();
  await expect(page.getByLabel("اسم المتجر (مطلوب)")).toHaveValue("موبايلات الحلبي");
  await expect(page.getByLabel("الهاتف 1")).toHaveValue("+963 11 222 3344");

  // Departments: the default one is listed; N opens a new one in the side panel.
  await tabTo(page, navigation.getByRole("link", { name: "الأقسام" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/departments/);
  const table = page.getByRole("grid", { name: "الأقسام" });
  await expect(table.getByRole("row").filter({ hasText: "المتجر" })).toContainText("الافتراضي");
  await page.keyboard.press("n");
  const panel = page.getByRole("complementary", { name: "قسم جديد" });
  await expect(panel.getByLabel("اسم القسم (مطلوب)")).toBeFocused();
  await page.keyboard.type("الصيانة");
  await page.keyboard.press("Control+S");
  const added = page.getByRole("complementary", { name: "الصيانة" });
  await expect(added.getByRole("status")).toHaveText("أُضيف القسم «الصيانة»");
  await expect(page).toHaveURL(/selected=/);
  const row = table.getByRole("row").filter({ hasText: "الصيانة" });
  await expect(row).toHaveAttribute("aria-selected", "true");
  await attachScreens(page, testInfo, "departments");

  // Esc closes the panel and gives focus back to the list; the arrows move the selection.
  await page.keyboard.press("Escape");
  await expect(added).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("complementary", { name: "المتجر" })).toContainText(
    "القسم الافتراضي",
  );
  await page.keyboard.press("Escape");

  // The filters live in the URL: the archived list is empty, and it survives a reload.
  // The status filter is one tab stop; the arrows move within it (right to left: next is left).
  await tabTo(page, page.getByRole("radio", { name: "النشطة" }));
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "المؤرشفة" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/status=archived/);
  await page.reload();
  await expect(page.getByRole("radio", { name: "المؤرشفة" })).toBeChecked();
  await expect(table.getByRole("row").filter({ hasText: "لا أقسام تطابق البحث" })).toBeVisible();
});

test("keyboard only: read the license and plan, and go to where a limit is managed", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await tabTo(page, navigation.getByRole("link", { name: "الترخيص والباقة" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/license$/);
  await expect(page.getByRole("heading", { name: "الترخيص والباقة", level: 1 })).toBeVisible();

  // The run's license: a year of the phones plan, so active; each limit as used of allowed.
  await expect(page.getByText("الاحترافية لمحلات الموبايل")).toBeVisible();
  await expect(page.getByText("ساري", { exact: true })).toBeVisible();
  const limits = page.getByRole("table");
  for (const limit of [
    "المستخدمون النشطون",
    "الأقسام النشطة",
    "الأجهزة الرئيسية (كاشير)",
    "الأجهزة المساعدة (موبايل)",
  ]) {
    await expect(limits.getByRole("row").filter({ hasText: limit })).toContainText(/\d+ من \d+/);
  }
  await expectAccessible(page);
  await attachScreens(page, testInfo, "license");

  // Each limit links to the screen where it is managed.
  await tabTo(page, limits.getByRole("link", { name: "إدارة المستخدمين" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/users/);
});

test("the side navigation collapses to icons and keeps its labels", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  // The frame mounts once it knows who is signed in; a shortcut pressed before is not heard.
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Control+B");
  await expect(navigation).toHaveAttribute("data-collapsed", "true");
  // The width animates; wait for it to settle.
  await expect.poll(async () => (await navigation.boundingBox())?.width).toBeLessThanOrEqual(56);
  await expect(navigation.getByRole("link", { name: "الأقسام" })).toBeVisible();
  // Remembered on this device.
  await page.reload();
  await expect(navigation).toHaveAttribute("data-collapsed", "true");
  await expectAccessible(page);
  await navigation.getByRole("button", { name: "توسيع القائمة" }).press("Enter");
  await expect(navigation).not.toHaveAttribute("data-collapsed");
});

test("the component gallery opens without a session", async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { name: "معرض مكوّنات مستوفي", level: 1 })).toBeVisible();
  await expect(page.locator("[data-component='SidePanel']")).toHaveCount(6);
  await expectAccessible(page);
});
