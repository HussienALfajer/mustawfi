import type { APIRequestContext, Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { e2eStore } from "./environment.ts";
import { runCli } from "./server-cli.ts";
import { attachScreens, signIn, tabTo } from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

const LOGIN = "rana";
const FIRST_PASSWORD = "rana's first long password";
const SECOND_PASSWORD = "rana's second long password";
const THIRD_PASSWORD = "rana's password after the reset";

/**
 * A second owner for this journey, added through the API as the store's owner would: the
 * journey changes her password and turns on two-factor authentication, which must not touch
 * the owner the other journeys sign in as. Only an owner gets a support reset code.
 */
async function addSecondOwner(request: APIRequestContext): Promise<void> {
  const store = e2eStore();
  const signedIn = await request.post("/api/v1/access/login", {
    data: { storeCode: store.storeCode, login: store.login, password: store.password },
  });
  expect(signedIn.status()).toBe(200);
  const { token } = (await signedIn.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const roles = (await (await request.get("/api/v1/access/roles", { headers })).json()) as {
    items: { id: string; isOwner: boolean }[];
  };
  const created = await request.post("/api/v1/access/users", {
    headers,
    data: {
      name: "رنا",
      login: LOGIN,
      password: FIRST_PASSWORD,
      roleId: roles.items.find((role) => role.isOwner)?.id,
      departmentScope: "all",
      pin: "4826",
    },
  });
  expect(created.status()).toBe(201);
}

/** The code an authenticator app shows for `secret`, `steps` periods from now. */
function appCode(secret: string, steps = 0): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    timestamp: Date.now() + steps * 30_000,
  });
}

async function signOut(page: Page): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: "تسجيل الخروج" }), 60);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login/);
}

test("keyboard only: «My account» changes the PIN and password and turns on 2FA; sign-in asks for a code or a recovery code; a support reset code recovers", async ({
  page,
  request,
}, testInfo) => {
  await addSecondOwner(request);
  await signIn(page, FIRST_PASSWORD, LOGIN);
  await expect(page).toHaveURL(/\/products$/);

  // «My account» from the top bar.
  await tabTo(page, page.getByRole("link", { name: "حسابي" }), 60);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "حسابي", level: 1 })).toBeVisible();

  // PIN: proved with the current one; Enter moves on and submits on the last field.
  const pinForm = page.getByRole("form", { name: "الرمز السري" });
  await tabTo(page, pinForm.getByLabel("الرمز السري الحالي"), 60);
  await page.keyboard.type("4826");
  await page.keyboard.press("Enter");
  await page.keyboard.type("3691");
  await page.keyboard.press("Enter");
  await page.keyboard.type("3691");
  await page.keyboard.press("Enter");
  await expect(pinForm.getByRole("status")).toHaveText("تغيّر رمزك السري");

  // Password.
  const passwordForm = page.getByRole("form", { name: "كلمة المرور" });
  await tabTo(page, passwordForm.getByLabel("كلمة المرور الحالية"));
  await page.keyboard.type(FIRST_PASSWORD);
  await page.keyboard.press("Enter");
  await page.keyboard.type(SECOND_PASSWORD);
  await page.keyboard.press("Enter");
  await page.keyboard.type(SECOND_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(passwordForm.getByRole("status")).toHaveText("تغيّرت كلمة مرورك");
  await expectAccessible(page);

  // Two-factor authentication: the password starts it, the app's first code turns it on.
  const twoFactor = page.getByRole("region", { name: "التحقق بخطوتين" });
  await tabTo(page, twoFactor.getByLabel("كلمة المرور الحالية"));
  await page.keyboard.type(SECOND_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(twoFactor.getByRole("img", { name: /رمز مربّع/ })).toBeVisible();
  const secret = ((await twoFactor.getByLabel("المفتاح").textContent()) ?? "").replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(twoFactor.getByLabel("الرمز من التطبيق")).toBeFocused();
  await attachScreens(page, testInfo, "my-account-2fa-setup");
  await page.keyboard.type(appCode(secret));
  await page.keyboard.press("Enter");

  const codesList = twoFactor.getByRole("list", { name: "رموز الاسترداد" });
  await expect(codesList.getByRole("listitem")).toHaveCount(10);
  const recoveryCodes = await codesList.getByRole("listitem").allTextContents();
  await attachScreens(page, testInfo, "my-account-recovery-codes");
  await tabTo(page, twoFactor.getByRole("button", { name: "حفظتُ الرموز" }));
  await page.keyboard.press("Enter");
  await expect(twoFactor).toContainText("بقيت لك 10 رموز استرداد");
  await attachScreens(page, testInfo, "my-account");

  // Sign-in now asks for the app's code (the next one: the first was used up).
  await signOut(page);
  await signIn(page, SECOND_PASSWORD, LOGIN);
  const code = page.getByLabel("رمز التحقق");
  await expect(code).toBeFocused();
  await expect(page.getByRole("heading", { name: "التحقق بخطوتين", level: 1 })).toBeVisible();
  await attachScreens(page, testInfo, "sign-in-second-factor");
  await page.keyboard.type(appCode(secret, 1));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/products$/);

  // Or a recovery code, when the phone is not at hand.
  await signOut(page);
  await signIn(page, SECOND_PASSWORD, LOGIN);
  await expect(page.getByLabel("رمز التحقق")).toBeFocused();
  await page.keyboard.type(recoveryCodes[0] ?? "");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/products$/);
  await signOut(page);

  // Lost the password: Vertex support issues a reset code; setting a new password with it
  // clears two-factor authentication too.
  const store = e2eStore();
  const issued = JSON.parse(
    await runCli(
      "src/cli/reset-code.ts",
      ["--store", store.storeCode, "--login", LOGIN, "--staff", "e2e support"],
      { DATABASE_URL: store.databaseUrl },
    ),
  ) as { code: string };
  await tabTo(page, page.getByRole("link", { name: /نسيت كلمة المرور/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/recover$/);
  await expect(page.getByLabel("رمز المتجر")).toBeFocused();
  for (const text of [store.storeCode, LOGIN, issued.code, THIRD_PASSWORD, THIRD_PASSWORD]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByLabel("رمز سري جديد (اختياري)")).toBeFocused();
  await attachScreens(page, testInfo, "recovery");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\?reset=true$/);
  await expect(page.getByRole("status")).toHaveText("عُيّنت كلمة المرور الجديدة. ادخل بها الآن");
  await expectAccessible(page);

  await signIn(page, THIRD_PASSWORD, LOGIN);
  await expect(page).toHaveURL(/\/products$/);
});
