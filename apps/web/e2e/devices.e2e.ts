import { e2eStore } from "./environment.ts";
import { attachScreens, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

test("keyboard only: register this browser from the devices screen, then revoke it", async ({
  page,
}, testInfo) => {
  // A name no other journey's device has: the store's list holds theirs too.
  const name = `جهاز الإبطال ${String(Date.now()).slice(-6)}`;
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });

  // Flow 9: N opens a new device beside the list; the code is issued with the store code.
  await tabTo(page, navigation.getByRole("link", { name: "الأجهزة" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/devices/);
  await expect(page.getByRole("grid", { name: "الأجهزة" })).toBeVisible();
  await page.keyboard.press("n");
  const added = page.getByRole("complementary", { name: "إضافة جهاز" });
  await expect(added.getByRole("button", { name: "إصدار رمز تسجيل" })).toBeFocused();
  await page.keyboard.press("Enter");
  const code = added.getByTestId("registration-code");
  await expect(code).toHaveText(/^\S+$/);
  await expect(added.getByTestId("store-code")).toHaveText(e2eStore().storeCode);
  const registrationCode = (await code.textContent()) ?? "";
  await expectAccessible(page);
  await page.keyboard.press("Escape");

  // Flow 4: this browser registers with it.
  await tabTo(page, navigation.getByRole("link", { name: "تسجيل الجهاز" }), 40);
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByLabel("رمز المتجر"));
  await page.keyboard.type(e2eStore().storeCode);
  await page.keyboard.press("Tab");
  await page.keyboard.type(registrationCode);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("اسم الجهاز")).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  const prefix = (await page.getByTestId("device-prefix").textContent()) ?? "";
  expect(prefix).toMatch(/^[A-HJ-NP-Z2-9]{2}$/);
  // Its first sync brings the signed configuration bundle, verified in the browser: Ed25519 and
  // SHA-256 through WebCrypto, the license by the license key (`core-foundation` rule 11).
  await expect(page.getByTestId("device-bundle")).toHaveText(/^الإصدار [0-9٠-٩]+، موثّقة$/);

  // The list shows it: type, prefix, last sync, status, and that it is this one.
  await tabTo(page, navigation.getByRole("link", { name: "الأجهزة" }), 40);
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("searchbox", { name: "ابحث بالاسم أو البادئة" }));
  await page.keyboard.type(name);
  const row = page
    .getByRole("grid", { name: "الأجهزة" })
    .getByRole("row")
    .filter({ hasText: name });
  await expect(row).toContainText("جهاز مساعد");
  await expect(row).toContainText(prefix);
  await expect(row).toContainText("هذا الجهاز");
  await expect(row).toContainText("نشط");
  // Its first sync round has reached the server.
  await expect(async () => {
    await page.reload();
    await expect(row).not.toContainText("لم يتزامن بعد", { timeout: 1000 });
  }).toPass();
  // Focus selects the row, and its panel follows.
  await tabTo(page, row);
  const panel = page.getByRole("complementary", { name });
  await expect(panel).toContainText("نشط");
  await attachScreens(page, testInfo, "devices");

  // Revoke it, with a reason: it sends what it holds, wipes its data, and says so.
  await tabTo(page, panel.getByRole("button", { name: "إبطال الجهاز" }), 40);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: `إبطال الجهاز «${name}»؟` });
  await expect(dialog).toContainText("هذا هو الجهاز الذي تعمل عليه الآن");
  await tabTo(page, dialog.getByLabel("سبب الإبطال"));
  await page.keyboard.type("انتهى استخدامه");
  await tabTo(page, dialog.getByRole("button", { name: "إبطال الجهاز" }));
  await page.keyboard.press("Enter");

  const removed = page.getByRole("heading", { name: "أُزيل هذا الجهاز من المتجر", level: 1 });
  await expect(removed).toBeVisible();
  await expectAccessible(page);
  await attachScreens(page, testInfo, "device-removed");
  await expect(page.getByRole("button", { name: "متابعة" })).toBeFocused();
  await page.keyboard.press("Enter");

  // Back to registering this browser: its registration and its data are gone.
  await expect(page).toHaveURL(/\/device$/);
  await expect(page.getByLabel("رمز التسجيل")).toBeVisible();

  // The owner sees it revoked, with the reason, and its wipe reported.
  await tabTo(page, navigation.getByRole("link", { name: "الأجهزة" }), 40);
  await page.keyboard.press("Enter");
  // The status choice: its selected option, then the next one (right to left: next is left).
  await tabTo(page, page.getByRole("radio", { name: "النشطة" }));
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "المُبطَلة" })).toBeFocused();
  await page.keyboard.press("Space");
  await tabTo(page, page.getByRole("searchbox", { name: "ابحث بالاسم أو البادئة" }));
  await page.keyboard.type(name);
  await expect(row).toContainText("مُبطَل، مُسحت بياناته");
  await expect(row).not.toContainText("هذا الجهاز");
});
