import {
  issueRegistrationCode,
  routeAccessTable,
  type RouteAccessEntry,
} from "@mustawfi/core-access/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { licenseSummarySchema } from "@mustawfi/core-organization/shared";
import type { SyncOperation } from "@mustawfi/core-sync/shared";
import {
  installLicense,
  openTenantDatabase,
  type TenantDatabase,
} from "@mustawfi/core-tenancy/server";
import {
  businessDate,
  licenseStateStarts,
  tenancyProblemCodes,
} from "@mustawfi/core-tenancy/shared";
import type { ProductView } from "@mustawfi/inventory/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { LicenseTermsInput } from "@mustawfi/tools-license";
import { issueTestLicense, testLicenseKeys } from "@mustawfi/tools-license/testing";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { Secret, TOTP } from "otpauth";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry, serverPermissions } from "./modules.ts";
import { invoiceOperation } from "./sales-operations.test-helpers.ts";
import { createStaffUser, signInAs, STAFF_PASSWORD } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

const PASSWORD = "correct horse battery staple";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 86_400_000;
// The clock only moves forward: each scenario makes its own store and ages it.
const clock = manualClock(new Date("2026-10-01T09:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;
let routes: readonly RouteAccessEntry[];

beforeAll(async () => {
  database = await createTestDatabase("license_enforcement");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
  routes = routeAccessTable(server).filter((route) => route.method !== "HEAD");
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

let storeCount = 0;

/** A store whose license, issued now, expires `expiresIn` from now with these terms. */
async function newStore(
  expiresIn: number,
  terms: Pick<LicenseTermsInput, "graceDays" | "readOnlyDays" | "limits"> = {},
): Promise<CreatedTenant> {
  storeCount += 1;
  return createLicensedTenant(
    tenants,
    {
      name: `متجر الترخيص ${String(storeCount)}`,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: PASSWORD,
    },
    dependencies,
    { expiresAt: new Date(clock.now().getTime() + expiresIn), ...terms },
  );
}

const ownerToken = (store: CreatedTenant) => signInAs(server, store, "ahmad", PASSWORD);

/** A non-owner whose role holds every declared permission, signed in now. */
async function staffToken(store: CreatedTenant, login = "staff"): Promise<string> {
  const all = [...serverPermissions().permissions.keys()];
  await createStaffUser(tenants, store, { login, permissions: all }, dependencies);
  return signInAs(server, store, login);
}

/** Issues a registration code as the owner, bypassing the routes (which may be closed). */
function registrationCode(store: CreatedTenant): Promise<string> {
  return tenants.withTenant({ tenantId: store.tenantId, userId: store.ownerId }, async (tx) => {
    const issued = await issueRegistrationCode(
      tx,
      { tenantId: store.tenantId, branchId: store.branchId, userId: store.ownerId },
      dependencies,
    );
    return issued.code;
  });
}

interface TestDevice {
  readonly deviceId: string;
  readonly prefix: string;
  readonly credential: string;
}

async function registerDevice(store: CreatedTenant): Promise<TestDevice> {
  const response = await server.inject(registration(store, await registrationCode(store)));
  expect(response.statusCode).toBe(201);
  return response.json<TestDevice>();
}

function registration(store: CreatedTenant, code: string): InjectOptions {
  return {
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: store.storeCode,
      registrationCode: code,
      type: "mainPos",
      name: "الصندوق",
    },
  };
}

/** A request to `route` with any path parameter filled in, an empty body, and a bearer. */
function request(route: RouteAccessEntry, bearer?: string): InjectOptions {
  const options: InjectOptions = {
    method: route.method as NonNullable<InjectOptions["method"]>,
    url: route.url.replace(/:[a-zA-Z]+/g, newId()),
  };
  if (route.method !== "GET" && route.method !== "DELETE") options.payload = {};
  if (bearer !== undefined) options.headers = { authorization: `Bearer ${bearer}` };
  return options;
}

const name = (route: RouteAccessEntry) => `${route.method} ${route.url}`;
const isWrite = (route: RouteAccessEntry) => route.method !== "GET";
const isDeviceRoute = (route: RouteAccessEntry) =>
  route.access === "device" || route.access === "deviceEvenRevoked";

/** The problem code of a response, or `undefined` when it is not a problem. */
function problemCode(response: LightMyRequestResponse): string | undefined {
  if (!response.headers["content-type"]?.toString().includes("problem+json")) return undefined;
  return problemDetailsSchema.parse(response.json()).code;
}

function expectRefused(response: LightMyRequestResponse, code: string, what: string) {
  expect(response.statusCode, what).toBe(403);
  expect(problemCode(response), what).toBe(code);
}

function expectNotLicenseRefusal(response: LightMyRequestResponse, what: string) {
  expect(problemCode(response) ?? "", what).not.toMatch(/^tenancy\.license\./);
  expect([401, 403], what).not.toContain(response.statusCode);
}

describe("routes open while the license is read-only (core-foundation rule 5)", () => {
  it("are exactly sign-in, sign-out, the user's own account, push, and the wipe report", () => {
    expect(routes.filter((route) => route.allowedWhenReadOnly).map(name)).toEqual([
      "POST /api/v1/access/login",
      "POST /api/v1/access/pin-login",
      "POST /api/v1/access/password-reset",
      "POST /api/v1/access/logout",
      "POST /api/v1/access/devices/current/wipe",
      "GET /api/v1/access/me",
      "POST /api/v1/access/me/two-factor/enrolment",
      "POST /api/v1/access/me/two-factor/confirm",
      "POST /api/v1/access/me/two-factor/disable",
      "PUT /api/v1/access/me/pin",
      "PUT /api/v1/access/me/password",
      "POST /api/v1/sync/push",
    ]);
  });
});

describe("a read-only license (rule 5)", () => {
  let store: CreatedTenant;
  let owner: string;
  let staff: string;
  let device: TestDevice;

  beforeAll(async () => {
    store = await newStore(MINUTE, { graceDays: 0, readOnlyDays: 30 });
    device = await registerDevice(store);
    clock.advance(2 * MINUTE);
    owner = await ownerToken(store);
    staff = await staffToken(store);
  });

  it("refuses every write that is not exempt with 403 tenancy.license.readOnly, walking the route table", async () => {
    const writes = routes.filter((route) => isWrite(route) && !route.allowedWhenReadOnly);
    expect(writes.length).toBeGreaterThan(10);
    for (const route of writes) {
      let response: LightMyRequestResponse;
      if (route.access === "public") {
        // The guard cannot see a public route's tenant: its handler checks, after the code.
        expect(name(route), "a public write the test knows how to call").toBe(
          "POST /api/v1/access/devices",
        );
        response = await server.inject(registration(store, await registrationCode(store)));
      } else {
        response = await server.inject(
          request(route, isDeviceRoute(route) ? device.credential : owner),
        );
      }
      expectRefused(response, tenancyProblemCodes.licenseReadOnly, name(route));
    }
  });

  it("serves every read to owners and to other users", async () => {
    for (const route of routes.filter((r) => !isWrite(r) && r.access !== "public")) {
      const bearers = isDeviceRoute(route) ? [device.credential] : [owner, staff];
      for (const bearer of bearers) {
        expectNotLicenseRefusal(await server.inject(request(route, bearer)), name(route));
      }
    }
  });

  it("keeps the exempt routes open", async () => {
    for (const route of routes.filter((r) => r.allowedWhenReadOnly)) {
      const bearer = isDeviceRoute(route) ? device.credential : await ownerToken(store);
      const response = await server.inject(
        request(route, route.access === "public" ? undefined : bearer),
      );
      expect(problemCode(response) ?? "", name(route)).not.toMatch(/^tenancy\.license\./);
    }
  });

  it("refuses a device registration only after the code is checked, and keeps the code unused", async () => {
    const wrong = await server.inject(registration(store, "AAAAA-BBBBB"));
    expect(wrong.statusCode).toBe(401);
    const code = await registrationCode(store);
    expectRefused(
      await server.inject(registration(store, code)),
      tenancyProblemCodes.licenseReadOnly,
      "registration",
    );
    const { rows } = await superuser.query<{ used: number }>(
      "select count(*)::int as used from core_access.registration_codes where tenant_id = $1 and used_at is not null",
      [store.tenantId],
    );
    expect(rows[0]?.used).toBe(1); // the device registered before the license turned read-only
  });

  it("reopens writes on the next request once a renewal is installed", async () => {
    const rename = () =>
      server.inject({
        method: "PATCH",
        url: `/api/v1/organization/departments/${store.defaultDepartmentId}`,
        headers: { authorization: `Bearer ${owner}` },
        payload: { name: "المتجر بعد التجديد" },
      });
    expectRefused(await rename(), tenancyProblemCodes.licenseReadOnly, "before the renewal");
    const { jws } = await issueTestLicense({ tenant: store.tenantId, issuedAt: clock.now() });
    const licenseKeys = await testLicenseKeys();
    await tenants.withTenant({ tenantId: store.tenantId }, (tx) =>
      installLicense(tx, { jws }, { ...dependencies, licenseKeys }),
    );
    expect((await rename()).statusCode).toBe(200);
  });
});

/** Turns on two-factor authentication for the user of `token`; returns the recovery codes. */
async function enableTwoFactor(token: string): Promise<string[]> {
  const headers = { authorization: `Bearer ${token}` };
  const started = await server.inject({
    method: "POST",
    url: "/api/v1/access/me/two-factor/enrolment",
    headers,
    payload: { currentPassword: STAFF_PASSWORD },
  });
  expect(started.statusCode).toBe(201);
  const secret = Secret.fromBase32(started.json<{ secret: string }>().secret);
  const confirmed = await server.inject({
    method: "POST",
    url: "/api/v1/access/me/two-factor/confirm",
    headers,
    payload: { code: TOTP.generate({ secret, timestamp: clock.now().getTime() }) },
  });
  expect(confirmed.statusCode).toBe(200);
  return confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes;
}

describe("a suspended license (rule 5)", () => {
  let recoveryCodes: string[];
  let store: CreatedTenant;
  let owner: string;
  let staff: string;
  let device: TestDevice;

  beforeAll(async () => {
    store = await newStore(MINUTE, { graceDays: 0, readOnlyDays: 0 });
    device = await registerDevice(store);
    // Opened while the license was active: suspension turns it away all the same.
    staff = await staffToken(store);
    recoveryCodes = await enableTwoFactor(await staffToken(store, "guarded"));
    clock.advance(2 * MINUTE);
    owner = await ownerToken(store);
  });

  it("turns away a non-owner's session on every route but the exempt ones, reads included", async () => {
    const sessionRoutes = routes.filter(
      (r) => !r.allowedWhenReadOnly && r.access !== "public" && !isDeviceRoute(r),
    );
    for (const route of sessionRoutes) {
      expectRefused(
        await server.inject(request(route, staff)),
        tenancyProblemCodes.licenseSuspended,
        name(route),
      );
    }
  });

  it("refuses a non-owner's sign-in, but lets them sign out", async () => {
    const signIn = await server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      payload: {
        storeCode: store.storeCode,
        login: "staff",
        password: STAFF_PASSWORD,
      },
    });
    expectRefused(signIn, tenancyProblemCodes.licenseSuspended, "sign-in");
    const logout = await server.inject({
      method: "POST",
      url: "/api/v1/access/logout",
      headers: { authorization: `Bearer ${staff}` },
    });
    expect(logout.statusCode).toBe(204);
  });

  it("turns a non-owner with 2FA away before asking for, or using up, a second factor", async () => {
    const signIn = (secondFactor?: string) =>
      server.inject({
        method: "POST",
        url: "/api/v1/access/login",
        payload: {
          storeCode: store.storeCode,
          login: "guarded",
          password: STAFF_PASSWORD,
          ...(secondFactor === undefined ? {} : { secondFactor }),
        },
      });
    expectRefused(await signIn(), tenancyProblemCodes.licenseSuspended, "without a code");
    expectRefused(
      await signIn(recoveryCodes[0]),
      tenancyProblemCodes.licenseSuspended,
      "with a recovery code",
    );
    const { rows } = await superuser.query<{ used: number }>(
      "select count(*)::int as used from core_access.recovery_codes where tenant_id = $1 and used_at is not null",
      [store.tenantId],
    );
    expect(rows[0]?.used).toBe(0);
  });

  it("lets owners in to read, and refuses their writes as read-only", async () => {
    // Signing out would end the token the walk uses; sign-out is checked above.
    const ownerRoutes = routes.filter(
      (r) => r.access !== "public" && !isDeviceRoute(r) && r.url !== "/api/v1/access/logout",
    );
    for (const route of ownerRoutes) {
      const response = await server.inject(request(route, owner));
      if (isWrite(route) && !route.allowedWhenReadOnly) {
        expectRefused(response, tenancyProblemCodes.licenseReadOnly, name(route));
      } else {
        expectNotLicenseRefusal(response, name(route));
      }
    }
  });

  it("still serves the device its pull and its bundle, and lets its push through", async () => {
    const bearer = { authorization: `Bearer ${device.credential}` };
    const pull = await server.inject({ method: "GET", url: "/api/v1/sync/pull", headers: bearer });
    expect(pull.statusCode).toBe(200);
    const bundle = await server.inject({
      method: "GET",
      url: "/api/v1/sync/bundle",
      headers: bearer,
    });
    expect(bundle.statusCode).toBe(200);
    const push = await server.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: bearer,
      payload: { operations: [] },
    });
    // Past the guard: the empty batch is the body's fault (400), not the license's.
    expectNotLicenseRefusal(push, "push");
  });
});

describe("state transitions by the server clock (rule 3)", () => {
  it("moves at each boundary instant to the later state, and no sooner", async () => {
    const store = await newStore(20 * DAY, { graceDays: 7, readOnlyDays: 30 });
    const issuedAt = clock.now().getTime();
    await createStaffUser(
      tenants,
      store,
      { login: "staff", permissions: [...serverPermissions().permissions.keys()] },
      dependencies,
    );
    const starts = licenseStateStarts({
      expiresAt: new Date(issuedAt + 20 * DAY).toISOString(),
      graceDays: 7,
      readOnlyDays: 30,
    });
    const instants: { at: number; writable: boolean; staffAdmitted: boolean }[] = [
      { at: starts.expiring - 1, writable: true, staffAdmitted: true },
      { at: starts.expiring, writable: true, staffAdmitted: true },
      { at: starts.grace - 1, writable: true, staffAdmitted: true },
      { at: starts.grace, writable: true, staffAdmitted: true },
      { at: starts.readOnly - 1, writable: true, staffAdmitted: true },
      { at: starts.readOnly, writable: false, staffAdmitted: true },
      { at: starts.suspended - 1, writable: false, staffAdmitted: true },
      { at: starts.suspended, writable: false, staffAdmitted: false },
    ];
    let staff = "";
    for (const [index, instant] of instants.entries()) {
      clock.set(new Date(instant.at));
      const what = `at ${new Date(instant.at).toISOString()}`;
      const owner = await ownerToken(store);
      // Sessions last seven days; a suspended license opens none for staff, so the last is kept.
      if (instant.staffAdmitted) staff = await signInAs(server, store, "staff");
      const rename = await server.inject({
        method: "PATCH",
        url: `/api/v1/organization/departments/${store.defaultDepartmentId}`,
        headers: { authorization: `Bearer ${owner}` },
        payload: { name: `المتجر ${String(index)}` },
      });
      if (instant.writable) expect(rename.statusCode, what).toBe(200);
      else expectRefused(rename, tenancyProblemCodes.licenseReadOnly, what);
      const read = await server.inject({
        method: "GET",
        url: "/api/v1/organization/departments",
        headers: { authorization: `Bearer ${staff}` },
      });
      if (instant.staffAdmitted) expect(read.statusCode, what).toBe(200);
      else expectRefused(read, tenancyProblemCodes.licenseSuspended, what);
    }
  });
});

describe("documents pushed after the tenant became read-only (rule 5, ADR-0030)", () => {
  let store: CreatedTenant;
  let device: TestDevice;
  let product: ProductView;
  let readOnlyAt: Date;
  let seq = 0;

  beforeAll(async () => {
    store = await newStore(HOUR, { graceDays: 0, readOnlyDays: 30 });
    readOnlyAt = new Date(clock.now().getTime() + HOUR);
    device = await registerDevice(store);
    const created = await server.inject({
      method: "POST",
      url: "/api/v1/inventory/products",
      headers: { authorization: `Bearer ${await ownerToken(store)}` },
      payload: { name: "شاحن", price: { amount: "1000", currency: "SYP" } },
    });
    expect(created.statusCode).toBe(201);
    product = created.json<ProductView>();
  });

  const dayAfter = (date: string, days: number) =>
    new Date(Date.parse(`${date}T12:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);

  async function push(dated: string): Promise<{ opId: string; flags: unknown[] }> {
    seq += 1;
    const operation: SyncOperation = invoiceOperation({
      newId,
      device,
      userId: store.ownerId,
      departmentId: store.defaultDepartmentId,
      deviceSeq: seq,
      lines: [{ productId: product.id, quantity: "1", unitPrice: "1000" }],
      createdAt: clock.now(),
      payload: { businessDate: dated },
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { authorization: `Bearer ${device.credential}` },
      payload: { operations: [operation] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ results: { status: string }[] }>().results).toEqual([
      expect.objectContaining({ status: "accepted" }),
    ]);
    const { rows } = await superuser.query<Record<string, unknown>>(
      "select code, detail from core_sync.operation_flags where op_id = $1",
      [operation.opId],
    );
    return { opId: operation.opId, flags: rows };
  }

  it("flags nothing while the tenant is not read-only yet, a document dated later included", async () => {
    const readOnlyDate = businessDate(readOnlyAt);
    expect((await push(dayAfter(readOnlyDate, 1))).flags).toEqual([]);
  });

  it("accepts every document once read-only, flagging those dated after the day it began", async () => {
    clock.set(new Date(readOnlyAt.getTime() + 2 * DAY));
    const readOnlyDate = businessDate(readOnlyAt);
    expect((await push(dayAfter(readOnlyDate, -1))).flags).toEqual([]);
    expect((await push(readOnlyDate)).flags).toEqual([]);
    expect((await push(dayAfter(readOnlyDate, 1))).flags).toEqual([
      {
        code: "licenseReadOnly",
        detail: { businessDate: dayAfter(readOnlyDate, 1), readOnlyBusinessDate: readOnlyDate },
      },
    ]);
  });

  it("flags nothing after a renewal, which lifts the restriction at once", async () => {
    const { jws } = await issueTestLicense({ tenant: store.tenantId, issuedAt: clock.now() });
    const licenseKeys = await testLicenseKeys();
    await tenants.withTenant({ tenantId: store.tenantId }, (tx) =>
      installLicense(tx, { jws }, { ...dependencies, licenseKeys }),
    );
    expect((await push(dayAfter(businessDate(readOnlyAt), 1))).flags).toEqual([]);
  });
});

describe("the «License and plan» summary", () => {
  it("shows the plan, the state, its dates, and each limit as used of allowed, overage included", async () => {
    const store = await newStore(10 * DAY, { graceDays: 7, readOnlyDays: 30 });
    const issuedAt = clock.now().getTime();
    const owner = await ownerToken(store);
    const added = await server.inject({
      method: "POST",
      url: "/api/v1/organization/departments",
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: "الصيانة" },
    });
    expect(added.statusCode).toBe(201);
    await registerDevice(store);
    // A downgrade to one department deactivates nothing (rule 4): used exceeds allowed.
    clock.advance(MINUTE);
    const { jws } = await issueTestLicense({
      tenant: store.tenantId,
      issuedAt: clock.now(),
      expiresAt: new Date(issuedAt + 10 * DAY),
      limits: { departments: 1 },
    });
    const licenseKeys = await testLicenseKeys();
    await tenants.withTenant({ tenantId: store.tenantId }, (tx) =>
      installLicense(tx, { jws }, { ...dependencies, licenseKeys }),
    );

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/organization/license",
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(response.statusCode).toBe(200);
    expect(licenseSummarySchema.parse(response.json())).toEqual({
      plan: "phonesPro",
      state: "expiring",
      expiresAt: new Date(issuedAt + 10 * DAY).toISOString(),
      readOnlyAt: new Date(issuedAt + 17 * DAY).toISOString(),
      suspendedAt: new Date(issuedAt + 47 * DAY).toISOString(),
      limits: [
        { limit: "users", used: 1, allowed: 6 },
        { limit: "departments", used: 2, allowed: 1 },
        { limit: "mainPosDevices", used: 1, allowed: 3 },
        { limit: "companionDevices", used: 0, allowed: 2 },
      ],
    });
  });
});

describe("the license in the sign-in and session answers (rule 10)", () => {
  it("tells every signed-in user the state by the server's clock, with its dates", async () => {
    const store = await newStore(5 * DAY, { graceDays: 7, readOnlyDays: 30 });
    const expiresAt = new Date(clock.now().getTime() + 5 * DAY);
    const standing = {
      state: "expiring",
      expiresAt: expiresAt.toISOString(),
      readOnlyAt: new Date(expiresAt.getTime() + 7 * DAY).toISOString(),
      suspendedAt: new Date(expiresAt.getTime() + 37 * DAY).toISOString(),
    };
    const login = await server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      payload: { storeCode: store.storeCode, login: "ahmad", password: PASSWORD },
    });
    expect(login.json()).toMatchObject({ license: standing });
    const staff = await staffToken(store);
    const session = await server.inject({
      method: "GET",
      url: "/api/v1/access/session",
      headers: { authorization: `Bearer ${staff}` },
    });
    expect(session.json()).toMatchObject({ user: { role: { isOwner: false } }, license: standing });
    clock.advance(6 * DAY);
    const later = await server.inject({
      method: "GET",
      url: "/api/v1/access/session",
      headers: { authorization: `Bearer ${staff}` },
    });
    expect(later.json()).toMatchObject({ license: { ...standing, state: "grace" } });
  });
});
