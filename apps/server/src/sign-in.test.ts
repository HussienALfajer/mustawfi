import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import { issueTestLicense, testLicenseKeys } from "@mustawfi/tools-license/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry } from "./modules.ts";
import { createStaffUser, STAFF_PASSWORD } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { installTenantLicense } from "./tenants/install-license.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * `core-foundation` slice 8: sign-in rate limits (rule 21), sessions bound to their device
 * (rule 22), and device limits at registration (rule 4), through the HTTP API with an injected
 * clock.
 */

const PASSWORD = "correct horse battery staple";
const WRONG = "a wrong password, long enough";
const MINUTE = 60_000;
const WINDOW = 15 * MINUTE;
const DEVICE_HEADER = "mustawfi-device";
const clock = manualClock(new Date("2026-09-26T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

/** Each test signs in from its own address, so the per-address count stays its own. */
let addressCounter = 0;
function nextAddress(): string {
  addressCounter += 1;
  return `203.0.113.${String(addressCounter)}`;
}

function newTenant(
  name: string,
  terms: Parameters<typeof createLicensedTenant>[3] = {},
): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
    terms,
  );
}

beforeAll(async () => {
  database = await createTestDatabase("sign_in");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { tenants, ...dependencies, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

interface From {
  readonly address: string;
  readonly device?: string;
}

function logIn(
  from: From,
  body: { storeCode: string; login: string; password: string; transport?: string },
) {
  return server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    remoteAddress: from.address,
    headers: from.device === undefined ? {} : { [DEVICE_HEADER]: from.device },
    payload: body,
  });
}

function pinLogIn(from: From, body: { userId: string; pin: string }) {
  return server.inject({
    method: "POST",
    url: "/api/v1/access/pin-login",
    remoteAddress: from.address,
    headers: from.device === undefined ? {} : { [DEVICE_HEADER]: from.device },
    payload: body,
  });
}

function getSession(token: string, device?: string) {
  return server.inject({
    method: "GET",
    url: "/api/v1/access/session",
    headers: {
      authorization: `Bearer ${token}`,
      ...(device === undefined ? {} : { [DEVICE_HEADER]: device }),
    },
  });
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  const body = problemDetailsSchema.parse(response.json());
  expect(body).toMatchObject({ status, code });
  return body;
}

async function ownerToken(tenant: CreatedTenant, from: From = { address: nextAddress() }) {
  const response = await logIn(from, {
    storeCode: tenant.storeCode,
    login: "ahmad",
    password: PASSWORD,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    device_id: string | null;
    entity_id: string | null;
    after: Record<string, unknown> | null;
  }>(
    `select created_by, device_id, entity_id, after from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

async function registerDevice(tenant: CreatedTenant, type: "mainPos" | "companion" = "mainPos") {
  const code = await issueCode(tenant);
  const response = await register(tenant, code, type);
  expect(response.statusCode).toBe(201);
  return response.json<{ deviceId: string; credential: string }>();
}

async function issueCode(tenant: CreatedTenant): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/access/registration-codes",
    headers: { authorization: `Bearer ${await ownerToken(tenant)}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ code: string }>().code;
}

function register(tenant: CreatedTenant, registrationCode: string, type: "mainPos" | "companion") {
  return server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: { storeCode: tenant.storeCode, registrationCode, type, name: "جهاز" },
  });
}

/** Sets the owner's PIN through their own account, proved by their password. */
async function setOwnerPin(tenant: CreatedTenant, pin: string) {
  const response = await server.inject({
    method: "PUT",
    url: "/api/v1/access/me/pin",
    headers: { authorization: `Bearer ${await ownerToken(tenant)}` },
    payload: { currentPassword: PASSWORD, pin },
  });
  expect(response.statusCode).toBe(204);
}

describe("password sign-in rate limit per store and login (rule 21)", () => {
  it("throttles a login after five failures, even with the right password, and audits it once", async () => {
    const tenant = await newTenant("متجر التقييد");
    const from = { address: nextAddress() };
    const attempt = (password: string) =>
      logIn(from, { storeCode: tenant.storeCode, login: "ahmad", password });

    for (let i = 0; i < 5; i += 1) {
      expectProblem(await attempt(WRONG), 401, accessProblemCodes.loginFailed);
    }
    const throttled = expectProblem(
      await attempt(PASSWORD),
      429,
      accessProblemCodes.loginThrottled,
    );
    expect(throttled.detail).toContain(new Date(clock.now().getTime() + WINDOW).toISOString());
    for (let i = 0; i < 3; i += 1) {
      expectProblem(await attempt(WRONG), 429, accessProblemCodes.loginThrottled);
    }

    // Throttled attempts are neither checked nor audited as failures; the window once.
    expect(await auditOf(tenant.tenantId, "access.login.failed")).toHaveLength(5);
    const audited = await auditOf(tenant.tenantId, "access.login.throttled");
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      created_by: null,
      entity_id: tenant.ownerId,
      after: {
        scope: "login",
        until: new Date(clock.now().getTime() + WINDOW).toISOString(),
      },
    });

    // Another login of the store is not held back.
    const staff = await createStaffUser(
      tenants,
      tenant,
      { login: "samer", permissions: [] },
      dependencies,
    );
    expect(
      (
        await logIn(from, {
          storeCode: tenant.storeCode,
          login: staff.login,
          password: STAFF_PASSWORD,
        })
      ).statusCode,
    ).toBe(200);

    clock.advance(WINDOW - 1);
    expectProblem(await attempt(PASSWORD), 429, accessProblemCodes.loginThrottled);
    clock.advance(1);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
  });

  it("checks parallel guesses of one login one at a time", async () => {
    const tenant = await newTenant("متجر التوازي");
    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        logIn(
          { address: nextAddress() },
          { storeCode: tenant.storeCode, login: "ahmad", password: WRONG },
        ),
      ),
    );
    expect(answers.every((answer) => [401, 429].includes(answer.statusCode))).toBe(true);
    expect(answers.filter((answer) => answer.statusCode === 401).length).toBeLessThanOrEqual(5);
    const { rows } = await superuser.query(
      "select 1 from core_access.login_attempts where tenant_id = $1",
      [tenant.tenantId],
    );
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it("signs in concurrent correct attempts of one login, one after the other", async () => {
    const tenant = await newTenant("متجر الأجهزة المتزامنة");
    const answers = await Promise.all(
      Array.from({ length: 4 }, () =>
        logIn(
          { address: nextAddress() },
          { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
        ),
      ),
    );
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200]);
  });

  it("counts per store: the same login in another store signs in", async () => {
    const first = await newTenant("متجر أول");
    const second = await newTenant("متجر ثانٍ");
    const from = { address: nextAddress() };
    for (let i = 0; i < 5; i += 1) {
      await logIn(from, { storeCode: first.storeCode, login: "ahmad", password: WRONG });
    }
    expectProblem(
      await logIn(from, { storeCode: first.storeCode, login: "ahmad", password: PASSWORD }),
      429,
      accessProblemCodes.loginThrottled,
    );
    expect(
      (await logIn(from, { storeCode: second.storeCode, login: "AHMAD", password: PASSWORD }))
        .statusCode,
    ).toBe(200);
  });

  it("answers an unknown login and an unknown store code like a known one", async () => {
    const tenant = await newTenant("متجر الغرباء");
    const from = { address: nextAddress() };
    for (const storeCode of [tenant.storeCode, "ZZZZ22"]) {
      const attempt = () => logIn(from, { storeCode, login: "nobody", password: WRONG });
      for (let i = 0; i < 5; i += 1) {
        expectProblem(await attempt(), 401, accessProblemCodes.loginFailed);
      }
      expectProblem(await attempt(), 429, accessProblemCodes.loginThrottled);
    }
    // The unknown login is audited in its store, with no user; the unknown store nowhere.
    expect(await auditOf(tenant.tenantId, "access.login.throttled")).toMatchObject([
      { created_by: null, entity_id: null, after: { scope: "login" } },
    ]);
  });

  it("clears the count on a success, and forgets failures spread over more than a window", async () => {
    const tenant = await newTenant("متجر النسيان");
    const from = { address: nextAddress() };
    const attempt = (password: string) =>
      logIn(from, { storeCode: tenant.storeCode, login: "ahmad", password });
    for (let i = 0; i < 4; i += 1) await attempt(WRONG);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) await attempt(WRONG);
    clock.advance(WINDOW);
    expectProblem(await attempt(WRONG), 401, accessProblemCodes.loginFailed);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
  });

  it("keeps only a hash of the typed login, and prunes failures too old to matter", async () => {
    const tenant = await newTenant("متجر السر");
    const from = { address: nextAddress() };
    const typed = "my-password-typed-by-mistake";
    await logIn(from, { storeCode: tenant.storeCode, login: typed, password: WRONG });
    const { rows } = await superuser.query<{ row: string }>(
      "select to_jsonb(a)::text as row from core_access.login_attempts a where tenant_id = $1",
      [tenant.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row).not.toContain(typed);

    clock.advance(2 * WINDOW);
    await logIn(from, { storeCode: tenant.storeCode, login: "ahmad", password: WRONG });
    const { rows: left } = await superuser.query(
      "select 1 from core_access.login_attempts where tenant_id = $1",
      [tenant.tenantId],
    );
    expect(left).toHaveLength(1);
  });
});

describe("sign-in rate limit per source address (rule 21)", () => {
  it("throttles an address after thirty failures across logins and stores, audited once per store per window", async () => {
    const first = await newTenant("متجر العنوان");
    const second = await newTenant("متجر العنوان الثاني");
    const from = { address: nextAddress() };
    // Eight logins, four failures each at most: no login reaches its own limit.
    for (let i = 0; i < 30; i += 1) {
      expectProblem(
        await logIn(from, {
          storeCode: i % 2 === 0 ? first.storeCode : "YYYY22",
          login: `guess${String(i % 8)}`,
          password: WRONG,
        }),
        401,
        accessProblemCodes.loginFailed,
      );
    }
    const refused = () =>
      logIn(from, { storeCode: first.storeCode, login: "ahmad", password: PASSWORD });
    expectProblem(await refused(), 429, accessProblemCodes.loginThrottled);
    expectProblem(await refused(), 429, accessProblemCodes.loginThrottled);
    expectProblem(
      await logIn(from, { storeCode: second.storeCode, login: "ahmad", password: PASSWORD }),
      429,
      accessProblemCodes.loginThrottled,
    );

    const audited = await auditOf(first.tenantId, "access.login.throttled");
    expect(audited).toMatchObject([
      { created_by: null, after: { scope: "address", address: from.address } },
    ]);
    expect(await auditOf(second.tenantId, "access.login.throttled")).toHaveLength(1);

    // Another address signs in; this one after the window.
    expect(
      (
        await logIn(
          { address: nextAddress() },
          { storeCode: first.storeCode, login: "ahmad", password: PASSWORD },
        )
      ).statusCode,
    ).toBe(200);
    clock.advance(WINDOW);
    expect((await refused()).statusCode).toBe(200);
  });

  it("counts a burst of parallel failures before any of them ends", async () => {
    const tenant = await newTenant("متجر الاندفاع");
    const from = { address: nextAddress() };
    const answers = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        logIn(from, {
          storeCode: tenant.storeCode,
          login: `burst${String(i % 10)}`,
          password: WRONG,
        }),
      ),
    );
    const failed = answers.filter((answer) => answer.statusCode === 401).length;
    expect(failed).toBeLessThanOrEqual(30);
    expect(answers.every((answer) => [401, 429].includes(answer.statusCode))).toBe(true);
  });
});

describe("sessions bound to their device (rule 22)", () => {
  it("binds a password sign-in on a registered device, which every request must then carry", async () => {
    const tenant = await newTenant("متجر الربط");
    const device = await registerDevice(tenant);
    const other = await registerDevice(tenant);
    const response = await logIn(
      { address: nextAddress(), device: device.credential },
      { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
    );
    expect(response.statusCode).toBe(200);
    const { token } = response.json<{ token: string }>();

    const { rows } = await superuser.query<{ device_id: string; method: string }>(
      "select device_id, method from core_access.sessions where tenant_id = $1 and device_id is not null",
      [tenant.tenantId],
    );
    expect(rows).toEqual([{ device_id: device.deviceId, method: "password" }]);
    expect(
      (await auditOf(tenant.tenantId, "access.login.succeeded")).some(
        (entry) => entry.device_id === device.deviceId,
      ),
    ).toBe(true);

    expect((await getSession(token, device.credential)).statusCode).toBe(200);
    expectProblem(await getSession(token), 401, accessProblemCodes.sessionRequired);
    expectProblem(
      await getSession(token, other.credential),
      401,
      accessProblemCodes.sessionRequired,
    );
    expectProblem(await getSession(token, "d1.nonsense"), 401, accessProblemCodes.sessionRequired);
    // A device credential is not a session.
    expectProblem(
      await getSession(device.credential, device.credential),
      401,
      accessProblemCodes.sessionRequired,
    );
  });

  it("binds a cookie session too", async () => {
    const tenant = await newTenant("متجر الكعكة");
    const device = await registerDevice(tenant, "companion");
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      remoteAddress: nextAddress(),
      headers: {
        [DEVICE_HEADER]: device.credential,
        origin: "https://store.example",
        host: "store.example",
      },
      payload: {
        storeCode: tenant.storeCode,
        login: "ahmad",
        password: PASSWORD,
        transport: "cookie",
      },
    });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers["set-cookie"]).split(";")[0] ?? "";
    const read = (headers: Record<string, string>) =>
      server.inject({
        method: "GET",
        url: "/api/v1/access/session",
        headers: { cookie, ...headers },
      });
    expect((await read({ [DEVICE_HEADER]: device.credential })).statusCode).toBe(200);
    expectProblem(await read({}), 401, accessProblemCodes.sessionRequired);
  });

  it("leaves a session opened without a device unbound", async () => {
    const tenant = await newTenant("متجر المتصفح");
    const device = await registerDevice(tenant);
    const token = await ownerToken(tenant);
    expect((await getSession(token)).statusCode).toBe(200);
    expect((await getSession(token, device.credential)).statusCode).toBe(200);
  });

  it("refuses a sign-in with a credential that is not a device's, and one from another store's device like an unknown store", async () => {
    const tenant = await newTenant("متجر الغريب");
    const elsewhere = await newTenant("متجر آخر");
    const foreign = await registerDevice(elsewhere);
    expectProblem(
      await logIn(
        { address: nextAddress(), device: "d1.nonsense" },
        { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
      ),
      401,
      accessProblemCodes.deviceRequired,
    );
    expectProblem(
      await logIn(
        { address: nextAddress(), device: foreign.credential },
        { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
      ),
      401,
      accessProblemCodes.loginFailed,
    );
  });
});

describe("online PIN sign-in on a registered device (rules 20–22)", () => {
  it("opens a session bound to the device, audited with it", async () => {
    const tenant = await newTenant("متجر الرمز");
    await setOwnerPin(tenant, "2580");
    const device = await registerDevice(tenant);
    const response = await pinLogIn(
      { address: nextAddress(), device: device.credential },
      { userId: tenant.ownerId, pin: "2580" },
    );
    expect(response.statusCode).toBe(200);
    const { token, user } = response.json<{ token: string; user: { id: string } }>();
    expect(user.id).toBe(tenant.ownerId);

    const { rows } = await superuser.query<{ device_id: string; method: string }>(
      "select device_id, method from core_access.sessions where tenant_id = $1 and method = 'pin'",
      [tenant.tenantId],
    );
    expect(rows).toEqual([{ device_id: device.deviceId, method: "pin" }]);
    const succeeded = await auditOf(tenant.tenantId, "access.login.succeeded");
    expect(succeeded.at(-1)).toMatchObject({
      created_by: tenant.ownerId,
      device_id: device.deviceId,
      after: { method: "pin" },
    });

    expect((await getSession(token, device.credential)).statusCode).toBe(200);
    expectProblem(await getSession(token), 401, accessProblemCodes.sessionRequired);
  });

  it("needs the device credential", async () => {
    const tenant = await newTenant("متجر بلا جهاز");
    await setOwnerPin(tenant, "2580");
    for (const device of [undefined, "d1.nonsense"]) {
      expectProblem(
        await pinLogIn(
          { address: nextAddress(), ...(device === undefined ? {} : { device }) },
          { userId: tenant.ownerId, pin: "2580" },
        ),
        401,
        accessProblemCodes.deviceRequired,
      );
    }
  });

  it("throttles a user on one device after five wrong PINs, not on another device, audited once", async () => {
    const tenant = await newTenant("متجر الأرقام");
    await setOwnerPin(tenant, "2580");
    const device = await registerDevice(tenant);
    const other = await registerDevice(tenant);
    const from = { address: nextAddress(), device: device.credential };
    for (let i = 0; i < 5; i += 1) {
      expectProblem(
        await pinLogIn(from, { userId: tenant.ownerId, pin: "1357" }),
        401,
        accessProblemCodes.loginFailed,
      );
    }
    expectProblem(
      await pinLogIn(from, { userId: tenant.ownerId, pin: "2580" }),
      429,
      accessProblemCodes.loginThrottled,
    );
    expect(
      (
        await pinLogIn(
          { address: nextAddress(), device: other.credential },
          { userId: tenant.ownerId, pin: "2580" },
        )
      ).statusCode,
    ).toBe(200);

    const failed = await auditOf(tenant.tenantId, "access.login.failed");
    expect(failed).toHaveLength(5);
    expect(failed[0]).toMatchObject({
      device_id: device.deviceId,
      entity_id: tenant.ownerId,
      after: { method: "pin" },
    });
    expect(await auditOf(tenant.tenantId, "access.login.throttled")).toMatchObject([
      { device_id: device.deviceId, entity_id: tenant.ownerId, after: { scope: "pin" } },
    ]);

    clock.advance(WINDOW);
    expect((await pinLogIn(from, { userId: tenant.ownerId, pin: "2580" })).statusCode).toBe(200);
  });

  it("signs in a PIN-only user, and fails an unknown or deactivated user like a wrong PIN", async () => {
    const tenant = await newTenant("متجر الكاشير");
    const owner = { authorization: `Bearer ${await ownerToken(tenant)}` };
    const roles = await server.inject({
      method: "GET",
      url: "/api/v1/access/roles",
      headers: owner,
    });
    const cashierRole = roles
      .json<{ items: { id: string; template: string | null }[] }>()
      .items.find((role) => role.template === "sectionCashier");
    const created = await server.inject({
      method: "POST",
      url: "/api/v1/access/users",
      headers: owner,
      payload: { name: "سامر", roleId: cashierRole?.id, departmentScope: "all", pin: "4826" },
    });
    expect(created.statusCode).toBe(201);
    const cashier = created.json<{ id: string }>();
    const device = await registerDevice(tenant);
    const from = { address: nextAddress(), device: device.credential };

    expect((await pinLogIn(from, { userId: cashier.id, pin: "4826" })).statusCode).toBe(200);
    expectProblem(
      await pinLogIn(from, { userId: newId(), pin: "4826" }),
      401,
      accessProblemCodes.loginFailed,
    );
    const deactivated = await server.inject({
      method: "POST",
      url: `/api/v1/access/users/${cashier.id}/deactivate`,
      headers: owner,
      payload: { reason: "غادر" },
    });
    expect(deactivated.statusCode).toBe(200);
    expectProblem(
      await pinLogIn(from, { userId: cashier.id, pin: "4826" }),
      401,
      accessProblemCodes.loginFailed,
    );
  });
});

describe("an unregistered-browser session (rule 22)", () => {
  it("cannot push or pull, so it creates no document", async () => {
    const tenant = await newTenant("متجر المتصفح الحر");
    const token = await ownerToken(tenant);
    const withSession = { authorization: `Bearer ${token}` };
    expectProblem(
      await server.inject({
        method: "POST",
        url: "/api/v1/sync/push",
        headers: withSession,
        payload: { operations: [] },
      }),
      401,
      accessProblemCodes.deviceRequired,
    );
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/sync/pull?cursor=0",
        headers: withSession,
      }),
      401,
      accessProblemCodes.deviceRequired,
    );
  });
});

describe("device limits at registration (rule 4)", () => {
  it("refuses a main POS or a companion beyond the license, keeping the code unused", async () => {
    const tenant = await newTenant("متجر الحدود", {
      limits: { mainPosDevices: 1, companionDevices: 1 },
    });
    await registerDevice(tenant, "mainPos");
    const code = await issueCode(tenant);
    expectProblem(
      await register(tenant, code, "mainPos"),
      409,
      tenancyProblemCodes.mainPosDeviceLimit,
    );
    // The refusal rolled back the code's use: it still registers a companion.
    expect((await register(tenant, code, "companion")).statusCode).toBe(201);
    expectProblem(
      await register(tenant, await issueCode(tenant), "companion"),
      409,
      tenancyProblemCodes.companionDeviceLimit,
    );
  });

  it("keeps the devices a lower license no longer allows, and refuses new ones", async () => {
    const tenant = await newTenant("متجر التخفيض");
    const kept = [await registerDevice(tenant), await registerDevice(tenant)];
    clock.advance(1000);
    const { jws } = await issueTestLicense({
      tenant: tenant.tenantId,
      issuedAt: clock.now(),
      limits: { mainPosDevices: 1 },
    });
    await installTenantLicense(
      tenants,
      { storeCode: tenant.storeCode, license: jws },
      { ...dependencies, licenseKeys: await testLicenseKeys() },
    );
    for (const device of kept) {
      const current = await server.inject({
        method: "GET",
        url: "/api/v1/access/devices/current",
        headers: { authorization: `Bearer ${device.credential}` },
      });
      expect(current.statusCode).toBe(200);
    }
    expectProblem(
      await register(tenant, await issueCode(tenant), "mainPos"),
      409,
      tenancyProblemCodes.mainPosDeviceLimit,
    );
  });
});
