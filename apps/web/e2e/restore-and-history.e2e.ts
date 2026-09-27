import { e2eStore } from "./environment.ts";
import { attachScreens, signIn, tabTo, toasts } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * `core-foundation` slice 20: an archived department is restored from its name typed again, in
 * another case and spacing; a details panel ends with its last change, which opens the record's
 * history in the audit log; and a device is renamed, its type shown in words with its platform
 * and the license limit it counts against.
 */

test("keyboard only: typing an archived department's name restores it, and its last change opens its history", async ({
  page,
}, testInfo) => {
  // A name no other journey's department has: the store's list holds theirs too.
  const suffix = String(Date.now()).slice(-6);
  const name = `Repairs ${suffix}`;
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await tabTo(page, navigation.getByRole("link", { name: "الأقسام" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/departments/);
  await expect(page.getByRole("grid", { name: "الأقسام" })).toBeVisible();

  // Add it, then archive it (confirmed once).
  await page.keyboard.press("n");
  const newPanel = page.getByRole("complementary", { name: "قسم جديد" });
  await expect(newPanel.getByLabel("اسم القسم (مطلوب)")).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Control+S");
  const panel = page.getByRole("complementary", { name });
  await expect(panel).toBeVisible();
  await tabTo(page, panel.getByRole("button", { name: "أرشفة القسم…" }), 40);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: `أرشفة القسم «${name}»؟` });
  await tabTo(page, dialog.getByRole("button", { name: "أرشفة" }));
  await page.keyboard.press("Enter");
  await expect(toasts(page)).toContainText(`أُرشف القسم «${name}»`);
  await expect(panel.getByRole("button", { name: "استعادة القسم" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Typed again for a new one, in another case and spacing: restoring it is offered instead.
  await page.keyboard.press("n");
  await expect(newPanel.getByLabel("اسم القسم (مطلوب)")).toBeFocused();
  await page.keyboard.type(`  repairs   ${suffix}`);
  const offer = newPanel.getByRole("status").filter({ hasText: "يوجد قسم مؤرشف" });
  await expect(offer).toContainText(`«${name}»`);
  await expectAccessible(page);
  await attachScreens(page, testInfo, "department-restore-offer");
  await tabTo(page, offer.getByRole("button", { name: `استعادة «${name}»` }));
  await page.keyboard.press("Enter");
  await expect(toasts(page)).toContainText(`استُعيد القسم «${name}»`);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("نشط", { exact: true })).toBeVisible();

  // The panel ends with its last change: the restore, by the owner. The owner reads the audit
  // log, so it is a link to this department's history, with that entry open.
  const lastChange = panel.getByRole("link", { name: /^آخر تعديل بواسطة/ });
  await expect(lastChange).toContainText("سامر");
  await expectAccessible(page);
  await attachScreens(page, testInfo, "department-last-change");
  await tabTo(page, lastChange, 40);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/audit\?.*entity=/);
  await expect(page.getByTestId("audit-entity-filter")).toBeVisible();
  const entry = page.getByRole("complementary", { name: "استعادة قسم مؤرشف" });
  await expect(entry).toBeVisible();
  const history = page.getByRole("grid", { name: "سجل التدقيق" });
  // Its whole history, newest first, and nothing else.
  await expect(history.getByRole("row")).toHaveCount(4);
  await expect(history.getByRole("row").nth(1)).toContainText("استعادة قسم مؤرشف");
  await expect(history.getByRole("row").nth(2)).toContainText("أرشفة قسم");
  await expect(history.getByRole("row").nth(3)).toContainText("إضافة قسم");
  await expectAccessible(page);
  await attachScreens(page, testInfo, "audit-record-history");
});

test("keyboard only: a device's type in words, its license limit, and a rename that keeps its prefix", async ({
  page,
}, testInfo) => {
  const name = `جهاز التسمية ${String(Date.now()).slice(-6)}`;
  const renamed = `${name} الجديد`;
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });

  // «This device», before registration: what this browser registers as, and the limit.
  await tabTo(page, navigation.getByRole("link", { name: "تسجيل الجهاز" }), 40);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("device-registers-as")).toContainText(
    "يُسجَّل هذا الجهاز بوصفه «متصفح — جهاز مساعد».",
  );
  await expect(page.getByTestId("device-registers-as")).toContainText("يُحسب ضمن الأجهزة المساعدة");

  // Issue a code (the registration panel names each kind and its limit), then register.
  await tabTo(page, navigation.getByRole("link", { name: "الأجهزة" }), 40);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("grid", { name: "الأجهزة" })).toBeVisible();
  await page.keyboard.press("n");
  const added = page.getByRole("complementary", { name: "إضافة جهاز" });
  await expect(added.getByTestId("device-kinds")).toContainText(
    /تطبيق Windows — جهاز بيع رئيسييُحسب ضمن أجهزة البيع الرئيسية: \d+ من \d+/,
  );
  await expect(added.getByTestId("device-kinds")).toContainText(
    /متصفح — جهاز مساعديُحسب ضمن الأجهزة المساعدة: \d+ من \d+/,
  );
  await expectAccessible(page);
  await attachScreens(page, testInfo, "device-registration-panel");
  await page.keyboard.press("Enter");
  const code = added.getByTestId("registration-code");
  await expect(code).toHaveText(/^\S+$/);
  const registrationCode = (await code.textContent()) ?? "";
  await page.keyboard.press("Escape");
  await tabTo(page, navigation.getByRole("link", { name: "تسجيل الجهاز" }), 40);
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByLabel("رمز المتجر"));
  await page.keyboard.type(e2eStore().storeCode);
  await page.keyboard.press("Tab");
  await page.keyboard.type(registrationCode);
  await page.keyboard.press("Tab");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  const prefix = (await page.getByTestId("device-prefix").textContent()) ?? "";
  expect(prefix).toMatch(/^[A-HJ-NP-Z2-9]{2}$/);
  await expect(page.getByTestId("device-type")).toHaveText("متصفح — جهاز مساعد");

  // Its panel: the type in words, the limit as used of allowed, and its name to change.
  await tabTo(page, navigation.getByRole("link", { name: "الأجهزة" }), 40);
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("searchbox", { name: "ابحث بالاسم أو البادئة" }));
  await page.keyboard.type(name);
  const row = page
    .getByRole("grid", { name: "الأجهزة" })
    .getByRole("row")
    .filter({ hasText: name });
  await expect(row).toContainText("متصفح — جهاز مساعد");
  await tabTo(page, row);
  const panel = page.getByRole("complementary", { name });
  await expect(panel.getByTestId("device-kind")).toContainText(
    /متصفح — جهاز مساعديُحسب ضمن الأجهزة المساعدة: \d+ من \d+/,
  );
  const field = panel.getByRole("textbox", { name: "اسم الجهاز", exact: true });
  await expect(field).toHaveAccessibleDescription(new RegExp(prefix));
  await tabTo(page, field, 40);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(renamed);
  // One field: Enter saves it.
  await page.keyboard.press("Enter");
  await expect(toasts(page)).toContainText(`صار اسم الجهاز «${renamed}»`);
  await expect(page.getByRole("complementary", { name: renamed })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: renamed }).getByRole("link", {
      name: /^آخر تعديل بواسطة/,
    }),
  ).toBeVisible();
  await expectAccessible(page);
  await attachScreens(page, testInfo, "device-panel");

  // «This device» reads its new name from the server; the prefix is the same.
  await tabTo(page, navigation.getByRole("link", { name: "تسجيل الجهاز" }), 40);
  await page.keyboard.press("Enter");
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await expect(page.getByTestId("device-prefix")).toHaveText(prefix);
  await expectAccessible(page);
});
