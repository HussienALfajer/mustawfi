import { attachScreens, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

test("keyboard only: the owner filters the audit log by user and opens an entry", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });

  // Flow 10: the log, newest first, under Administration.
  await tabTo(page, navigation.getByRole("link", { name: "سجل التدقيق" }), 40);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/audit/);
  const log = page.getByRole("grid", { name: "سجل التدقيق" });
  await expect(log).toBeVisible();
  await expectAccessible(page);

  // Filter by user: the owner, whose sign-in this journey just made.
  await tabTo(page, page.getByRole("button", { name: /المستخدم/ }));
  await page.keyboard.press("Enter");
  const owner = page.getByRole("option", { name: "سامر" });
  await expect(page.getByRole("option").first()).toBeFocused();
  for (let presses = 0; presses < 20; presses += 1) {
    if (await owner.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(owner).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]user=/);

  const rows = log.getByRole("row").filter({ hasText: "سامر" });
  const signedIn = log.getByRole("row").filter({ hasText: "تسجيل دخول" }).first();
  await expect(signedIn).toBeVisible();
  // Every row is the owner's: the header row and theirs only.
  expect(await log.getByRole("row").count()).toBe((await rows.count()) + 1);

  // Focus selects the newest sign-in; its panel opens beside the log.
  await tabTo(page, signedIn, 40);
  const panel = page.getByRole("complementary", { name: "تسجيل دخول" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("سامر");
  await expect(panel).toContainText("سُجّل على الخادم");
  await expect(panel).toContainText("الخادم");
  await expect(page).toHaveURL(/[?&]selected=/);
  await expectAccessible(page);
  await attachScreens(page, testInfo, "audit-log");

  // The filters live in the URL: a reload reopens the same log and entry.
  await page.reload();
  await expect(page.getByRole("complementary", { name: "تسجيل دخول" })).toBeVisible();
  await expect(page.getByRole("button", { name: /المستخدم/ })).toContainText("سامر");
});
