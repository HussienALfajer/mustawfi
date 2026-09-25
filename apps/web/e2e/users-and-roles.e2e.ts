import type { Locator, Page } from "@playwright/test";
import { attachScreens, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/** Presses a key until `target` has focus: the arrow keys in a list or a table. */
async function pressUntilFocused(page: Page, key: string, target: Locator, limit = 10) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

test("keyboard only: a section cashier scoped to a new department, and a copied role", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });

  // A new department: the department pickers appear once a second one is active.
  await tabTo(page, navigation.getByRole("link", { name: "الأقسام" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/departments/);
  await page.keyboard.press("n");
  await expect(page.getByLabel("اسم القسم (مطلوب)")).toBeFocused();
  await page.keyboard.type("تحويل الرصيد");
  await page.keyboard.press("Control+S");
  await expect(
    page.getByRole("complementary", { name: "تحويل الرصيد" }).getByRole("status"),
  ).toHaveText("أُضيف القسم «تحويل الرصيد»");
  await page.keyboard.press("Escape");

  // Users: the owner is listed; N opens a new user beside the list.
  await tabTo(page, navigation.getByRole("link", { name: "المستخدمون" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole("heading", { name: "المستخدمون", level: 1 })).toBeVisible();
  const table = page.getByRole("grid", { name: "المستخدمون" });
  await expect(table.getByRole("row").filter({ hasText: "سامر" })).toContainText("المالك");
  await page.keyboard.press("n");
  const panel = page.getByRole("complementary", { name: "مستخدم جديد" });
  await expect(panel.getByLabel("الاسم (مطلوب)")).toBeFocused();
  await page.keyboard.type("ليلى");
  await page.keyboard.press("Enter");
  await expect(panel.getByLabel("اسم الدخول (اختياري)")).toBeFocused();
  await page.keyboard.type("layla");
  await page.keyboard.press("Enter");
  await expect(panel.getByLabel("كلمة المرور (اختياري)")).toBeFocused();
  await page.keyboard.type("cashier password 1");

  // The role: open the list, type to jump to the option, Enter chooses it.
  await tabTo(page, panel.getByRole("button", { name: /الدور/ }));
  await page.keyboard.press("ArrowDown");
  const cashierOption = page.getByRole("option", { name: "كاشير القسم" });
  await pressUntilFocused(page, "ArrowDown", cashierOption);
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: /الدور/ })).toContainText("كاشير القسم");

  // The scope: listed departments, then the new one (right to left: next is left).
  await tabTo(page, panel.getByRole("radio", { name: "كل الأقسام" }));
  await page.keyboard.press("ArrowLeft");
  await expect(panel.getByRole("radio", { name: "أقسام محددة" })).toBeFocused();
  await page.keyboard.press("Space");
  await tabTo(page, panel.getByRole("checkbox", { name: "تحويل الرصيد" }));
  await page.keyboard.press("Space");
  await expect(panel.getByRole("checkbox", { name: "تحويل الرصيد" })).toBeChecked();
  await tabTo(page, panel.getByLabel("الرمز السري الأول (مطلوب)"));
  await page.keyboard.type("2580");
  await page.keyboard.press("Control+S");

  const added = page.getByRole("complementary", { name: "ليلى" });
  await expect(added.getByRole("status")).toHaveText("أُضيف المستخدم «ليلى»");
  const row = table.getByRole("row").filter({ hasText: "ليلى" });
  await expect(row).toContainText("كاشير القسم");
  await expect(row).toContainText("تحويل الرصيد");
  await expect(row).toHaveAttribute("aria-selected", "true");
  await attachScreens(page, testInfo, "users");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();

  // Roles: the section cashier's role holds its template's sales permission, scoped.
  await tabTo(page, navigation.getByRole("link", { name: "الأدوار والصلاحيات" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/roles/);
  const roles = page.getByRole("grid", { name: "الأدوار" });
  await tabTo(page, roles.getByRole("row").filter({ hasText: "المالك" }));
  await pressUntilFocused(
    page,
    "ArrowDown",
    roles.getByRole("row").filter({ hasText: "كاشير القسم" }),
  );
  const cashierRole = page.getByRole("complementary", { name: "كاشير القسم" });
  const sales = cashierRole.getByRole("group", { name: "المبيعات" });
  await expect(sales.getByRole("checkbox", { name: /البيع وإنشاء الفواتير/ })).toBeChecked();

  // Copy it, add a permission, and save the copy as a new role.
  await tabTo(page, cashierRole.getByRole("button", { name: "نسخ الدور" }), 60);
  await page.keyboard.press("Enter");
  const copy = page.getByRole("complementary", { name: "نسخة من «كاشير القسم»" });
  await expect(copy.getByLabel("اسم الدور (مطلوب)")).toBeFocused();
  await expect(copy.getByLabel("اسم الدور (مطلوب)")).toHaveValue("كاشير القسم (نسخة)");
  await tabTo(page, copy.getByRole("checkbox", { name: "عرض الفواتير" }));
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+S");
  const saved = page.getByRole("complementary", { name: "كاشير القسم (نسخة)" });
  await expect(saved.getByRole("status")).toHaveText("أُنشئ الدور «كاشير القسم (نسخة)»");
  await expect(saved.getByRole("checkbox", { name: "عرض الفواتير" })).toBeChecked();
  await attachScreens(page, testInfo, "roles");

  // The cashier sees only what their role opens: no administration.
  await tabTo(page, page.getByRole("button", { name: "تسجيل الخروج" }), 80);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "cashier password 1", "layla");
  await expect(page).toHaveURL(/\/products$/);
  await expect(navigation.getByRole("link", { name: "المنتجات" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "الإدارة" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "المستخدمون" })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page.getByRole("alert")).toHaveText("لا يسمح لك دورك بعرض المستخدمين.");
  await expectAccessible(page);
});
