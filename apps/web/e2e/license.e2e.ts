import type { APIRequestContext, Page } from "@playwright/test";
import type { LicenseTermsInput } from "@mustawfi/tools-license";
import { issueTestLicense, testLicensePublicKeys } from "@mustawfi/tools-license/testing";
import { e2eStore } from "./environment.ts";
import { runCli } from "./server-cli.ts";
import {
  addProduct,
  attachScreens,
  registerDevice,
  signIn,
  signInAgainOnDevice,
  signOut,
} from "./steps.ts";
import { expect, expectAccessible, test } from "./test.ts";

/**
 * `core-foundation` slice 13: the license on the device and on every screen — owners are warned
 * of expiry and grace, others are not; read-only stops the POS and says why; the day's state
 * holds until a sign-in on a later day; a clock moved back stops it too; a suspended store lets
 * only owners in. Each journey makes its own store with the `tenant:create` CLI.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const CASHIER = { login: "cashier", password: "cashier horse battery staple", name: "ليلى" };

interface JourneyStore {
  readonly storeCode: string;
  readonly tenantId: string;
}

type Terms = Pick<LicenseTermsInput, "notBefore" | "expiresAt" | "graceDays" | "readOnlyDays">;

let stores = 0;

async function createStore(terms: Terms): Promise<JourneyStore> {
  stores += 1;
  const license = await issueTestLicense({ ...terms, limits: { companionDevices: 5, users: 10 } });
  const created = await runCli(
    "src/cli/create-tenant.ts",
    [
      ...["--name", `متجر الترخيص ${String(stores)}`, "--base-currency", "SYP"],
      ...["--owner-name", "هالة", "--owner-login", "owner", "--license", license.jws],
    ],
    { DATABASE_URL: e2eStore().databaseUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
    `${PASSWORD}\n`,
  );
  const { storeCode } = JSON.parse(created) as { storeCode: string };
  return { storeCode, tenantId: license.claims.tenant };
}

/** Installs a newer license for the store, as Vertex staff do with the `license:install` CLI. */
async function installLicense(store: JourneyStore, terms: Terms): Promise<void> {
  const license = await issueTestLicense({ ...terms, tenant: store.tenantId });
  await runCli(
    "src/cli/install-license.ts",
    ["--store", store.storeCode, "--license", license.jws],
    { DATABASE_URL: e2eStore().databaseUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
  );
}

/** Adds a section cashier (no owner) through the API, as the owner. */
async function addCashier(request: APIRequestContext, store: JourneyStore): Promise<void> {
  const signedIn = await request.post("/api/v1/access/login", {
    data: { storeCode: store.storeCode, login: "owner", password: PASSWORD },
  });
  expect(signedIn.status()).toBe(200);
  const { token } = (await signedIn.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const roles = (await (await request.get("/api/v1/access/roles", { headers })).json()) as {
    items: { id: string; template: string | null }[];
  };
  const created = await request.post("/api/v1/access/users", {
    headers,
    data: {
      name: CASHIER.name,
      login: CASHIER.login,
      password: CASHIER.password,
      roleId: roles.items.find((role) => role.template === "sectionCashier")?.id,
      departmentScope: "all",
      pin: "4826",
    },
  });
  expect(created.status()).toBe(201);
}

const notice = (page: Page) => page.getByRole("banner").getByTestId("license-notice");

/**
 * The device's time follows the server's once it takes one (ADR-0021 amendment), so a day later on
 * the device alone is a day with no server contact: the bundle answer, which carries the server's
 * signed time, is held back until `resume`.
 */
async function withoutServerTime(page: Page): Promise<{ resume: () => Promise<void> }> {
  const pattern = "**/api/v1/sync/bundle**";
  await page.route(pattern, (route) => route.abort());
  return { resume: () => page.unroute(pattern) };
}

test("owners see the expiring and grace warnings, and a cashier sees neither", async ({
  page,
  request,
}, testInfo) => {
  const now = Date.now();
  const expiring = await createStore({ expiresAt: new Date(now + 5 * DAY) });
  await signIn(page, PASSWORD, "owner", expiring.storeCode);
  await expect(notice(page)).toHaveText(/^ينتهي الترخيص في /);
  // The owner may open «License and plan»: the warning leads there.
  await expect(notice(page).getByRole("link")).toHaveAttribute("href", "/admin/license");
  await attachScreens(page, testInfo, "license-expiring");
  await addCashier(request, expiring);
  await signOut(page, "هالة");
  await signIn(page, CASHIER.password, CASHIER.login, expiring.storeCode);
  await expect(page.getByRole("banner").getByRole("button", { name: /ليلى/ })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await expectAccessible(page);

  const grace = await createStore({
    notBefore: new Date(now - 30 * DAY),
    expiresAt: new Date(now - DAY),
    graceDays: 7,
  });
  await signOut(page, "ليلى");
  await signIn(page, PASSWORD, "owner", grace.storeCode);
  await expect(notice(page)).toHaveText(/^انتهى الترخيص، ومهلة السماح حتى /);
  await expectAccessible(page);
});

test("the device keeps the day's state, goes read-only at the next day's sign-in, and the POS says why", async ({
  page,
}, testInfo) => {
  const now = Date.now();
  // In grace now; read-only from tomorrow at this time.
  const store = await createStore({
    notBefore: new Date(now - 30 * DAY),
    expiresAt: new Date(now - DAY),
    graceDays: 2,
  });
  await signIn(page, PASSWORD, "owner", store.storeCode);
  await addProduct(page, "بطارية احتياطية", `629${String(now).slice(-10)}`, "30");
  await registerDevice(page, store.storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await page.getByRole("button", { name: "أضف بطارية احتياطية إلى السلة" }).click();
  // The device's own evaluation, from the verified bundle: grace, so the owner is warned.
  await expect(notice(page)).toHaveText(/^انتهى الترخيص، ومهلة السماح حتى /);
  const complete = page.getByRole("button", { name: "إتمام البيع نقدًا" });
  await expect(complete).toBeEnabled();

  // Two days later with no server contact, the session still open: the day's state holds (rule 6).
  const cutOff = await withoutServerTime(page);
  await page.clock.setFixedTime(new Date(now + 2 * DAY));
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByRole("link", { name: "البيع" }).click();
  await expect(complete).toBeEnabled();
  await expect(page.getByTestId("license-restriction")).toHaveCount(0);

  // The app opened again is that day's first session: read-only, and the POS says why.
  await page.reload();
  await expect(notice(page)).toHaveText("المتجر للقراءة فقط");
  const restriction = page.getByTestId("license-restriction");
  await expect(restriction).toContainText("المتجر للقراءة فقط منذ");
  await expect(restriction).toContainText("ويعود البيع فور تجديد الترخيص");
  await expect(complete).toBeDisabled();
  await expect(
    page.getByText("البيع متوقف على هذا الجهاز الآن، والسبب مبيّن فوق السلة"),
  ).toBeVisible();
  // The cart stays for later.
  await expect(
    page
      .getByRole("grid", { name: "السلة" })
      .getByRole("row")
      .filter({ hasText: "بطارية احتياطية" }),
  ).toBeVisible();
  await attachScreens(page, testInfo, "pos-read-only");

  // A renewal lifts it once the next bundle carries it (rule 6); the clock is set back to the
  // real time first, since the server's time would otherwise find it two days off.
  await installLicense(store, { expiresAt: new Date(now + 365 * DAY) });
  await cutOff.resume();
  await page.clock.setFixedTime(new Date());
  await page.reload();
  // Two days back since the last input: the session is over (rule 24), so sign in again.
  await signInAgainOnDevice(page, PASSWORD, "owner", store.storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await expect(page.getByTestId("license-restriction")).toHaveCount(0);
  await expect(complete).toBeEnabled();
  await expect(notice(page)).toHaveCount(0);
});

test("a clock moved back, or one far from the server's, stops the POS until it is right", async ({
  page,
}) => {
  const now = Date.now();
  const store = await createStore({ expiresAt: new Date(now + 365 * DAY) });
  await signIn(page, PASSWORD, "owner", store.storeCode);
  await registerDevice(page, store.storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await expect(page.getByTestId("license-restriction")).toHaveCount(0);

  // The app opened again with its clock an hour back and no server contact (the fake clock
  // applies from the next load): moved back.
  const cutOff = await withoutServerTime(page);
  await page.clock.setFixedTime(new Date(now - HOUR));
  await page.reload();
  // A clock an hour off is as far as an hour idle: the session is over (rule 24).
  await signInAgainOnDevice(page, PASSWORD, "owner", store.storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  await expect(notice(page)).toHaveText("ساعة الجهاز متأخرة");
  await expect(page.getByTestId("license-restriction")).toContainText(
    "صحّح التاريخ والوقت في الجهاز",
  );
  await expectAccessible(page);

  // The server reached, its time finds the clock an hour off: still no sale.
  await cutOff.resume();
  await page.reload();
  await expect(notice(page)).toHaveText("ساعة الجهاز غير مضبوطة");
  await expect(page.getByTestId("license-restriction")).toContainText(
    "اضبط التاريخ والوقت والمنطقة الزمنية",
  );

  // The clock set right again, the next round with the server lifts it.
  await page.clock.setFixedTime(new Date());
  await page.reload();
  await signInAgainOnDevice(page, PASSWORD, "owner", store.storeCode);
  await page.getByRole("link", { name: "البيع" }).click();
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await expect(page.getByTestId("license-restriction")).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
});

test("a suspended store lets only owners in, and tells the others why", async ({
  page,
  request,
}, testInfo) => {
  const now = Date.now();
  const store = await createStore({ expiresAt: new Date(now + 365 * DAY) });
  await addCashier(request, store);
  await signIn(page, CASHIER.password, CASHIER.login, store.storeCode);
  await expect(page.getByRole("banner").getByRole("button", { name: /ليلى/ })).toBeVisible();

  await installLicense(store, {
    notBefore: new Date(now - 60 * DAY),
    expiresAt: new Date(now - 50 * DAY),
    graceDays: 1,
    readOnlyDays: 1,
  });
  // The cashier's open session is turned away: «store suspended», and sign-out.
  await page.reload();
  await expect(page).toHaveURL(/\/suspended$/);
  await expect(page.getByRole("heading", { level: 1, name: "المتجر موقوف" })).toBeVisible();
  const leave = page.getByRole("button", { name: "تسجيل الخروج" });
  await expect(leave).toBeFocused();
  await attachScreens(page, testInfo, "store-suspended");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);

  // Signing in again is refused with the reason.
  await signIn(page, CASHIER.password, CASHIER.login, store.storeCode);
  await expect(page.getByRole("alert")).toHaveText(
    "ترخيص المتجر موقوف، فلا يدخل إلا المالكون حتى يُجدَّد. اطلب من صاحب المتجر تجديد الترخيص",
  );
  await expectAccessible(page);

  // The owner comes in, and sees the store is suspended.
  await signIn(page, PASSWORD, "owner", store.storeCode);
  await expect(notice(page)).toHaveText("المتجر موقوف");
  await expectAccessible(page);
});
