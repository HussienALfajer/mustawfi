import { issueResetCode } from "@mustawfi/core-access/server";
import { accessProblemCodes, RECOVERY_CODE_COUNT } from "@mustawfi/core-access/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import { Secret, TOTP } from "otpauth";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry } from "./modules.ts";
import { createStaffUser, STAFF_PASSWORD } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * `core-foundation` slice 10: TOTP two-factor authentication with recovery codes (rule 26),
 * through the HTTP API with an injected clock.
 */

const PASSWORD = "correct horse battery staple";
const STEP_MS = 30_000;
const DEVICE_HEADER = "mustawfi-device";
// Five seconds into a 30-second step, so a step boundary is never crossed by accident.
const clock = manualClock(new Date("2026-09-26T08:00:05.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

/** Each sign-in comes from its own address, so the per-address count never interferes. */
let addressCounter = 0;
function nextAddress(): string {
  addressCounter += 1;
  return `198.51.100.${String(addressCounter % 250)}`;
}

beforeAll(async () => {
  database = await createTestDatabase("two_factor");
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

function newTenant(name: string): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
  );
}

function logIn(
  tenant: CreatedTenant,
  body: { password?: string; secondFactor?: string; login?: string } = {},
  device?: string,
) {
  return server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    remoteAddress: nextAddress(),
    headers: device === undefined ? {} : { [DEVICE_HEADER]: device },
    payload: {
      storeCode: tenant.storeCode,
      login: body.login ?? "ahmad",
      password: body.password ?? PASSWORD,
      ...(body.secondFactor === undefined ? {} : { secondFactor: body.secondFactor }),
    },
  });
}

async function tokenOf(pending: Promise<{ statusCode: number; json<T>(): T }>): Promise<string> {
  const response = await pending;
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

function call(
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  return server.inject({
    method,
    url: `/api/v1/access${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

/** The code the authenticator app shows for `secret` at the clock's time, plus `steps`. */
function codeFor(secret: string, steps = 0): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    timestamp: clock.now().getTime() + steps * STEP_MS,
  });
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    entity_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `select created_by, entity_id, before, after from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

/** Enables two-factor authentication for the user of `token`; returns the secret and codes. */
async function enable(token: string, password = PASSWORD) {
  const started = await call(token, "POST", "/me/two-factor/enrolment", {
    currentPassword: password,
  });
  expect(started.statusCode).toBe(201);
  const { secret, uri } = started.json<{ secret: string; uri: string }>();
  const confirmed = await call(token, "POST", "/me/two-factor/confirm", { code: codeFor(secret) });
  expect(confirmed.statusCode).toBe(200);
  const { recoveryCodes } = confirmed.json<{ recoveryCodes: string[] }>();
  return { secret, uri, recoveryCodes };
}

describe("enabling two-factor authentication (rule 26, flow 11)", () => {
  it("starts with the password, turns on with the app's first code, and gives ten recovery codes once", async () => {
    const tenant = await newTenant("متجر التحقق");
    const token = await tokenOf(logIn(tenant));

    const before = await call(token, "GET", "/me");
    expect(before.json()).toMatchObject({
      id: tenant.ownerId,
      hasPassword: true,
      hasPin: false,
      twoFactor: { enabled: false, enabledAt: null, recoveryCodesLeft: 0 },
    });

    expectProblem(
      await call(token, "POST", "/me/two-factor/enrolment", { currentPassword: "wrong one!" }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expectProblem(
      await call(token, "POST", "/me/two-factor/confirm", { code: "123456" }),
      409,
      accessProblemCodes.twoFactorNotStarted,
    );

    const started = await call(token, "POST", "/me/two-factor/enrolment", {
      currentPassword: PASSWORD,
    });
    expect(started.statusCode).toBe(201);
    const { secret, uri } = started.json<{ secret: string; uri: string }>();
    expect(uri).toMatch(/^otpauth:\/\/totp\/Mustawfi:ahmad%40[A-Z0-9]+\?/);
    expect(uri).toContain(`secret=${secret}`);
    // Not in force before the confirmation: the password alone still signs in.
    expect((await logIn(tenant)).statusCode).toBe(200);

    expectProblem(
      await call(token, "POST", "/me/two-factor/confirm", { code: codeFor(secret, 3) }),
      422,
      accessProblemCodes.twoFactorCodeInvalid,
    );
    const confirmed = await call(token, "POST", "/me/two-factor/confirm", {
      code: codeFor(secret),
    });
    expect(confirmed.statusCode).toBe(200);
    const { recoveryCodes } = confirmed.json<{ recoveryCodes: string[] }>();
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

    expect((await call(token, "GET", "/me")).json()).toMatchObject({
      twoFactor: {
        enabled: true,
        enabledAt: clock.now().toISOString(),
        recoveryCodesLeft: RECOVERY_CODE_COUNT,
      },
    });
    expect(await auditOf(tenant.tenantId, "access.twoFactor.enabled")).toEqual([
      {
        created_by: tenant.ownerId,
        entity_id: tenant.ownerId,
        before: { twoFactor: false },
        after: { twoFactor: true, recoveryCodes: RECOVERY_CODE_COUNT },
      },
    ]);
    // Only the hashes are kept; the codes are never shown again.
    const { rows } = await superuser.query<{ code_hash: string }>(
      "select code_hash from core_access.recovery_codes where tenant_id = $1",
      [tenant.tenantId],
    );
    expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of recoveryCodes) {
      expect(JSON.stringify(rows)).not.toContain(code.replace("-", ""));
    }

    expectProblem(
      await call(token, "POST", "/me/two-factor/enrolment", { currentPassword: PASSWORD }),
      409,
      accessProblemCodes.twoFactorAlreadyEnabled,
    );
  });

  it("keeps the secret encrypted with the server key", async () => {
    const tenant = await newTenant("متجر السر المختوم");
    const token = await tokenOf(logIn(tenant));
    const { secret } = await enable(token);
    const { rows } = await superuser.query<{ totp_secret: string }>(
      "select totp_secret from core_access.users where id = $1",
      [tenant.ownerId],
    );
    const sealed = rows[0]?.totp_secret ?? "";
    expect(sealed).toMatch(/^v1\.test\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const raw = Buffer.from(Secret.fromBase32(secret).bytes);
    for (const encoding of ["hex", "base64", "base64url"] as const) {
      expect(sealed).not.toContain(raw.toString(encoding));
    }
    expect(sealed).not.toContain(secret);
  });

  it("refuses a user without a password", async () => {
    const tenant = await newTenant("متجر الرمز فقط");
    const owner = await tokenOf(logIn(tenant));
    const roles = await call(owner, "GET", "/roles");
    const cashierRole = roles
      .json<{ items: { id: string; template: string | null }[] }>()
      .items.find((role) => role.template === "sectionCashier");
    const created = await call(owner, "POST", "/users", {
      name: "سامر",
      roleId: cashierRole?.id,
      departmentScope: "all",
      pin: "4826",
    });
    const cashier = created.json<{ id: string }>();
    const device = await registerDevice(tenant, owner);
    const cashierToken = await tokenOf(
      server.inject({
        method: "POST",
        url: "/api/v1/access/pin-login",
        remoteAddress: nextAddress(),
        headers: { [DEVICE_HEADER]: device.credential },
        payload: { userId: cashier.id, pin: "4826" },
      }),
    );
    const answer = await server.inject({
      method: "POST",
      url: "/api/v1/access/me/two-factor/enrolment",
      headers: { authorization: `Bearer ${cashierToken}`, [DEVICE_HEADER]: device.credential },
      payload: { currentPassword: "anything at all" },
    });
    expectProblem(answer, 409, accessProblemCodes.twoFactorPasswordRequired);
  });
});

async function registerDevice(tenant: CreatedTenant, ownerToken: string) {
  const issued = await call(ownerToken, "POST", "/registration-codes");
  const registered = await server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: tenant.storeCode,
      registrationCode: issued.json<{ code: string }>().code,
      type: "mainPos",
      name: "الصندوق",
    },
  });
  expect(registered.statusCode).toBe(201);
  return registered.json<{ deviceId: string; credential: string }>();
}

describe("password sign-in with two-factor authentication (rule 26)", () => {
  it("asks for a code after the right password, accepts each code once, and audits how", async () => {
    const tenant = await newTenant("متجر الرمز المؤقت");
    const { secret } = await enable(await tokenOf(logIn(tenant)));

    expectProblem(await logIn(tenant), 401, accessProblemCodes.secondFactorRequired);
    // A wrong password is still just a wrong password, code or not.
    expectProblem(
      await logIn(tenant, { password: "not the password!", secondFactor: codeFor(secret) }),
      401,
      accessProblemCodes.loginFailed,
    );
    const failuresBefore = (await auditOf(tenant.tenantId, "access.login.failed")).length;

    // The code of the confirmation's own step was used: replaying it is refused.
    expectProblem(
      await logIn(tenant, { secondFactor: codeFor(secret) }),
      401,
      accessProblemCodes.secondFactorInvalid,
    );
    const failed = await auditOf(tenant.tenantId, "access.login.failed");
    expect(failed).toHaveLength(failuresBefore + 1);
    expect(failed.at(-1)).toMatchObject({
      entity_id: tenant.ownerId,
      after: { secondFactor: "invalid" },
    });

    clock.advance(STEP_MS);
    const code = codeFor(secret);
    const signedIn = await logIn(tenant, {
      secondFactor: ` ${code.slice(0, 3)} ${code.slice(3)} `,
    });
    expect(signedIn.statusCode).toBe(200);
    expect((await auditOf(tenant.tenantId, "access.login.succeeded")).at(-1)).toMatchObject({
      created_by: tenant.ownerId,
      after: { method: "password", secondFactor: "totp" },
    });
    expectProblem(
      await logIn(tenant, { secondFactor: code }),
      401,
      accessProblemCodes.secondFactorInvalid,
    );
    // A code of the step before the last one used is old news.
    expectProblem(
      await logIn(tenant, { secondFactor: codeFor(secret, -1) }),
      401,
      accessProblemCodes.secondFactorInvalid,
    );
    // The app's clock a step ahead is forgiven.
    expect((await logIn(tenant, { secondFactor: codeFor(secret, 1) })).statusCode).toBe(200);
  });

  it("accepts each recovery code once, as typed with or without its dash, and audits what is left", async () => {
    const tenant = await newTenant("متجر رموز الاسترداد");
    const { recoveryCodes } = await enable(await tokenOf(logIn(tenant)));
    const [first = "", second = ""] = recoveryCodes;

    expect((await logIn(tenant, { secondFactor: first })).statusCode).toBe(200);
    expectProblem(
      await logIn(tenant, { secondFactor: first }),
      401,
      accessProblemCodes.secondFactorInvalid,
    );
    const lowered = second.replace("-", "").toLowerCase();
    const token = await tokenOf(logIn(tenant, { secondFactor: lowered }));

    const used = await auditOf(tenant.tenantId, "access.twoFactor.recoveryCodeUsed");
    expect(used.map((entry) => entry.after?.["remaining"])).toEqual([
      RECOVERY_CODE_COUNT - 1,
      RECOVERY_CODE_COUNT - 2,
    ]);
    expect(used[0]).toMatchObject({ created_by: tenant.ownerId, entity_id: tenant.ownerId });
    expect((await auditOf(tenant.tenantId, "access.login.succeeded")).at(-1)).toMatchObject({
      after: { secondFactor: "recoveryCode" },
    });
    expect((await call(token, "GET", "/me")).json()).toMatchObject({
      twoFactor: { recoveryCodesLeft: RECOVERY_CODE_COUNT - 2 },
    });
  });

  it("counts wrong codes against the login's rate limit (rule 21)", async () => {
    const tenant = await newTenant("متجر التخمين");
    const { secret } = await enable(await tokenOf(logIn(tenant)));
    for (let i = 0; i < 5; i += 1) {
      expectProblem(
        await logIn(tenant, { secondFactor: "000000" }),
        401,
        accessProblemCodes.secondFactorInvalid,
      );
    }
    clock.advance(STEP_MS);
    expectProblem(
      await logIn(tenant, { secondFactor: codeFor(secret) }),
      429,
      accessProblemCodes.loginThrottled,
    );
    clock.advance(15 * 60_000);
    expect((await logIn(tenant, { secondFactor: codeFor(secret) })).statusCode).toBe(200);
  });

  it("never asks for it at PIN sign-in on a registered device", async () => {
    const tenant = await newTenant("متجر الرمز السري");
    const token = await tokenOf(logIn(tenant));
    const pinSet = await call(token, "PUT", "/me/pin", { currentPassword: PASSWORD, pin: "2580" });
    expect(pinSet.statusCode).toBe(204);
    const device = await registerDevice(tenant, token);
    await enable(token);

    const pin = await server.inject({
      method: "POST",
      url: "/api/v1/access/pin-login",
      remoteAddress: nextAddress(),
      headers: { [DEVICE_HEADER]: device.credential },
      payload: { userId: tenant.ownerId, pin: "2580" },
    });
    expect(pin.statusCode).toBe(200);
    // The password on the same device still needs the code.
    expectProblem(
      await logIn(tenant, {}, device.credential),
      401,
      accessProblemCodes.secondFactorRequired,
    );
  });
});

describe("turning two-factor authentication off", () => {
  it("takes the password and a code, deletes the recovery codes, and is audited", async () => {
    const tenant = await newTenant("متجر الإيقاف");
    const signedIn = await tokenOf(logIn(tenant));
    const { secret } = await enable(signedIn);
    clock.advance(STEP_MS);

    expectProblem(
      await call(signedIn, "POST", "/me/two-factor/disable", {
        currentPassword: "not the password!",
        code: codeFor(secret),
      }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expectProblem(
      await call(signedIn, "POST", "/me/two-factor/disable", {
        currentPassword: PASSWORD,
        code: "000000",
      }),
      422,
      accessProblemCodes.twoFactorCodeInvalid,
    );
    const off = await call(signedIn, "POST", "/me/two-factor/disable", {
      currentPassword: PASSWORD,
      code: codeFor(secret),
    });
    expect(off.statusCode).toBe(204);
    expect(await auditOf(tenant.tenantId, "access.twoFactor.disabled")).toEqual([
      {
        created_by: tenant.ownerId,
        entity_id: tenant.ownerId,
        before: { twoFactor: true },
        after: { twoFactor: false, proof: "totp" },
      },
    ]);
    const { rows } = await superuser.query(
      `select (select count(*)::int from core_access.recovery_codes where user_id = $1) as codes,
        totp_secret, totp_enabled_at, totp_last_step from core_access.users where id = $1`,
      [tenant.ownerId],
    );
    expect(rows).toEqual([
      { codes: 0, totp_secret: null, totp_enabled_at: null, totp_last_step: null },
    ]);
    expect((await logIn(tenant)).statusCode).toBe(200);
    expectProblem(
      await call(signedIn, "POST", "/me/two-factor/disable", {
        currentPassword: PASSWORD,
        code: codeFor(secret),
      }),
      409,
      accessProblemCodes.twoFactorNotEnabled,
    );
  });
});

describe("clearing another user's two-factor authentication (rule 26)", () => {
  it("is for owners only, not for one's own, and is audited", async () => {
    const tenant = await newTenant("متجر المالك");
    const owner = await tokenOf(logIn(tenant));
    const manager = await createStaffUser(
      tenants,
      tenant,
      { login: "manager", permissions: ["access.users.manage", "access.users.view"] },
      dependencies,
    );
    const managerToken = await tokenOf(
      logIn(tenant, { login: "manager", password: STAFF_PASSWORD }),
    );
    await enable(managerToken, STAFF_PASSWORD);
    const cashier = await createStaffUser(
      tenants,
      tenant,
      { login: "cashier", permissions: [] },
      dependencies,
    );

    expectProblem(
      await call(managerToken, "POST", `/users/${cashier.userId}/two-factor/clear`, {
        reason: "فقد هاتفه",
      }),
      403,
      accessProblemCodes.ownersOnly,
    );
    expectProblem(
      await call(owner, "POST", `/users/${cashier.userId}/two-factor/clear`, {
        reason: "فقد هاتفه",
      }),
      409,
      accessProblemCodes.twoFactorNotEnabled,
    );
    expectProblem(
      await call(owner, "POST", `/users/${tenant.ownerId}/two-factor/clear`, {
        reason: "فقد هاتفه",
      }),
      409,
      accessProblemCodes.useOwnAccount,
    );

    const users = await call(owner, "GET", "/users");
    expect(
      users
        .json<{ items: { id: string; twoFactorEnabled: boolean }[] }>()
        .items.find((user) => user.id === manager.userId)?.twoFactorEnabled,
    ).toBe(true);
    const cleared = await call(owner, "POST", `/users/${manager.userId}/two-factor/clear`, {
      reason: "فقد هاتفه",
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ id: manager.userId, twoFactorEnabled: false });
    expect(await auditOf(tenant.tenantId, "access.twoFactor.cleared")).toEqual([
      {
        created_by: tenant.ownerId,
        entity_id: manager.userId,
        before: { twoFactor: true },
        after: { twoFactor: false, clearedBy: "owner" },
      },
    ]);
    const { rows: reasons } = await superuser.query<{ reason: string }>(
      "select reason from core_audit.entries where tenant_id = $1 and action = 'access.twoFactor.cleared'",
      [tenant.tenantId],
    );
    expect(reasons).toEqual([{ reason: "فقد هاتفه" }]);
    expect((await logIn(tenant, { login: "manager", password: STAFF_PASSWORD })).statusCode).toBe(
      200,
    );
  });

  it("is part of the support reset of an owner's password (rule 27)", async () => {
    const tenant = await newTenant("متجر الاستعادة");
    await enable(await tokenOf(logIn(tenant)));
    const issued = await issueResetCode(
      tenants,
      { storeCode: tenant.storeCode, login: "ahmad", staff: "ليلى" },
      dependencies,
    );
    const reset = await server.inject({
      method: "POST",
      url: "/api/v1/access/password-reset",
      remoteAddress: nextAddress(),
      payload: {
        storeCode: tenant.storeCode,
        login: "ahmad",
        code: issued.code,
        password: "a new password after the reset",
      },
    });
    expect(reset.statusCode).toBe(204);
    expect(await auditOf(tenant.tenantId, "access.twoFactor.cleared")).toEqual([
      {
        created_by: tenant.ownerId,
        entity_id: tenant.ownerId,
        before: { twoFactor: true },
        after: { twoFactor: false, clearedBy: "support", resetCodeId: issued.id },
      },
    ]);
    expect((await logIn(tenant, { password: "a new password after the reset" })).statusCode).toBe(
      200,
    );
  });
});
