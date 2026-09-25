import {
  deactivateUser,
  editRole,
  hashPassword,
  userAccess,
  type UserAccess,
} from "@mustawfi/core-access/server";
import { accessProblemCodes, type RoleView, type UserView } from "@mustawfi/core-access/shared";
import { problemDetailsSchema, type PermissionCatalogue } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { issueTestLicense, testLicenseKeys } from "@mustawfi/tools-license/testing";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance, InjectOptions } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry, serverPermissions } from "./modules.ts";
import { createStaffUser, signInAs, STAFF_PASSWORD } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { installTenantLicense } from "./tenants/install-license.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";

const OWNER_PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-26T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;
let tenantCount = 0;

beforeAll(async () => {
  database = await createTestDatabase("users");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

interface Store {
  readonly tenant: CreatedTenant;
  /** The first owner's bearer token. */
  readonly owner: string;
}

/** A new store with its owner signed in; `users` overrides the license's user limit. */
async function newStore(users?: number): Promise<Store> {
  tenantCount += 1;
  const tenant = await createLicensedTenant(
    tenants,
    {
      name: `متجر ${String(tenantCount)}`,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: OWNER_PASSWORD,
    },
    dependencies,
    users === undefined ? {} : { limits: { users } },
  );
  return { tenant, owner: await signInAs(server, tenant, "ahmad", OWNER_PASSWORD) };
}

function call(
  token: string,
  method: NonNullable<InjectOptions["method"]>,
  url: string,
  payload?: object,
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
  expect(response.statusCode, JSON.stringify(response.json())).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

async function rolesOf(store: Store): Promise<RoleView[]> {
  const response = await call(store.owner, "GET", "/roles");
  expect(response.statusCode).toBe(200);
  return response.json<{ items: RoleView[] }>().items;
}

async function roleNamed(store: Store, name: string): Promise<RoleView> {
  const role = (await rolesOf(store)).find((r) => r.name === name);
  if (role === undefined) throw new Error(`no role ${name}`);
  return role;
}

let loginCount = 0;

/** Adds a user through the API as `token`; the answer is returned as it came. */
function postUser(token: string, body: Record<string, unknown>) {
  return call(token, "POST", "/users", { pin: "2580", departmentScope: "all", ...body });
}

async function addUser(store: Store, body: Record<string, unknown>): Promise<UserView> {
  loginCount += 1;
  const response = await postUser(store.owner, { name: `user ${String(loginCount)}`, ...body });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<UserView>();
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    entity_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string | null;
  }>(
    `select created_by, entity_id, before, after, reason from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

async function storedUser(id: string) {
  const { rows } = await superuser.query<{
    status: string;
    pin_verifier: string | null;
    password_hash: string | null;
    login: string | null;
  }>("select status, pin_verifier, password_hash, login from core_access.users where id = $1", [
    id,
  ]);
  const [row] = rows;
  if (row === undefined) throw new Error(`no user ${id}`);
  return row;
}

async function sessionStatus(token: string): Promise<number> {
  return (await call(token, "GET", "/session")).statusCode;
}

describe("adding users (flow 8)", () => {
  it("adds a user with a role, a listed scope, a first PIN, and a password, audited", async () => {
    const store = await newStore();
    const cashier = await roleNamed(store, "كاشير القسم");
    const response = await postUser(store.owner, {
      name: "سامر",
      login: "Samer",
      password: STAFF_PASSWORD,
      roleId: cashier.id,
      departmentScope: "listed",
      departments: [store.tenant.defaultDepartmentId],
      pin: "2580",
    });
    expect(response.statusCode, response.body).toBe(201);
    const user = response.json<UserView>();
    expect(user).toMatchObject({
      name: "سامر",
      login: "samer",
      role: { id: cashier.id, name: "كاشير القسم", isOwner: false },
      departmentScope: "listed",
      departments: [store.tenant.defaultDepartmentId],
      status: "active",
      hasPassword: true,
      hasPin: true,
    });

    const stored = await storedUser(user.id);
    expect(stored.pin_verifier).toMatch(/^\$argon2id\$/);
    expect(stored.pin_verifier).not.toContain("2580");
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);

    const created = (await auditOf(store.tenant.tenantId, "access.user.created")).find(
      (entry) => entry.entity_id === user.id,
    );
    expect(created).toMatchObject({
      created_by: store.tenant.ownerId,
      after: {
        name: "سامر",
        login: "samer",
        roleId: cashier.id,
        departmentScope: "listed",
        departments: [store.tenant.defaultDepartmentId],
        hasPassword: true,
        hasPin: true,
      },
    });
    expect(JSON.stringify(created)).not.toContain("2580");

    const signedIn = await signInAs(server, store.tenant, "samer");
    const session = await call(signedIn, "GET", "/session");
    expect(session.json()).toMatchObject({
      user: {
        id: user.id,
        departmentScope: "listed",
        permissions: ["inventory.products.view", "sales.invoice.create"],
      },
    });
  });

  it("adds a PIN-only user without login or password, who cannot sign in by password", async () => {
    const store = await newStore();
    const user = await addUser(store, { roleId: (await roleNamed(store, "فني الصيانة")).id });
    expect(user).toMatchObject({ login: null, hasPassword: false, hasPin: true });
  });

  it("refuses a password without a login, a missing PIN, and a PIN breaking rule 19", async () => {
    const store = await newStore();
    const roleId = (await roleNamed(store, "المحاسب")).id;
    const refused = [
      { name: "x", roleId, password: STAFF_PASSWORD },
      { name: "x", roleId, pin: undefined },
      ...["1111", "1234", "4321", "123", "1234567", "12a4"].map((pin) => ({
        name: "x",
        roleId,
        pin,
      })),
      { name: "x", roleId, departmentScope: "listed", departments: [] },
      {
        name: "x",
        roleId,
        departmentScope: "all",
        departments: [store.tenant.defaultDepartmentId],
      },
    ];
    for (const body of refused) {
      const response = await postUser(store.owner, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses a taken login, an archived or unknown role, and an unknown department", async () => {
    const store = await newStore();
    const roleId = (await roleNamed(store, "المحاسب")).id;
    expectProblem(
      await postUser(store.owner, { name: "x", login: "AHMAD", roleId }),
      409,
      accessProblemCodes.loginTaken,
    );
    expectProblem(
      await postUser(store.owner, { name: "x", roleId: newId() }),
      404,
      accessProblemCodes.roleNotFound,
    );
    const topUp = await roleNamed(store, "موظف تعبئة الرصيد");
    expect((await call(store.owner, "POST", `/roles/${topUp.id}/archive`)).statusCode).toBe(200);
    expectProblem(
      await postUser(store.owner, { name: "x", roleId: topUp.id }),
      409,
      accessProblemCodes.roleArchived,
    );
    expectProblem(
      await postUser(store.owner, {
        name: "x",
        roleId,
        departmentScope: "listed",
        departments: [newId()],
      }),
      422,
      accessProblemCodes.unknownDepartment,
    );
  });

  it("enforces the license's user limit; deactivated users do not count", async () => {
    const store = await newStore(3);
    const roleId = (await roleNamed(store, "المحاسب")).id;
    await addUser(store, { roleId });
    const third = await addUser(store, { roleId });
    expectProblem(
      await postUser(store.owner, { name: "fourth", roleId }),
      409,
      tenancyProblemCodes.userLimit,
    );
    const deactivated = await call(store.owner, "POST", `/users/${third.id}/deactivate`, {
      reason: "left the shop",
    });
    expect(deactivated.statusCode).toBe(200);
    const fourth = await addUser(store, { roleId });
    expectProblem(
      await call(store.owner, "POST", `/users/${third.id}/reactivate`),
      409,
      tenancyProblemCodes.userLimit,
    );
    expect(fourth.status).toBe("active");
  });

  it("deactivates nobody when a lower limit arrives, and refuses new users beyond it", async () => {
    const store = await newStore(4);
    const roleId = (await roleNamed(store, "المحاسب")).id;
    for (let i = 0; i < 3; i += 1) await addUser(store, { roleId });
    clock.advance(60_000);
    const { jws } = await issueTestLicense({
      tenant: store.tenant.tenantId,
      issuedAt: clock.now(),
      limits: { users: 2 },
    });
    await installTenantLicense(
      tenants,
      { storeCode: store.tenant.storeCode, license: jws },
      { ...dependencies, licenseKeys: await testLicenseKeys() },
    );
    const users = (await call(store.owner, "GET", "/users")).json<{ items: UserView[] }>().items;
    expect(users.filter((u) => u.status === "active")).toHaveLength(4);
    expectProblem(
      await postUser(store.owner, { name: "x", roleId }),
      409,
      tenancyProblemCodes.userLimit,
    );
  });
});

describe("owners (rule 14)", () => {
  it("keeps at least one active owner: the only owner cannot deactivate or demote themselves", async () => {
    const store = await newStore();
    const accountant = await roleNamed(store, "المحاسب");
    expectProblem(
      await call(store.owner, "POST", `/users/${store.tenant.ownerId}/deactivate`, {
        reason: "testing",
      }),
      409,
      accessProblemCodes.lastOwner,
    );
    expectProblem(
      await call(store.owner, "PATCH", `/users/${store.tenant.ownerId}`, { roleId: accountant.id }),
      409,
      accessProblemCodes.lastOwner,
    );

    const ownerRole = await roleNamed(store, "المالك");
    const second = await addUser(store, { roleId: ownerRole.id, login: "second" });
    const demoted = await call(store.owner, "PATCH", `/users/${store.tenant.ownerId}`, {
      roleId: accountant.id,
    });
    expect(demoted.statusCode, demoted.body).toBe(200);
    expect(demoted.json()).toMatchObject({ role: { id: accountant.id, isOwner: false } });
    expect(await auditOf(store.tenant.tenantId, "access.user.roleChanged")).toEqual([
      expect.objectContaining({
        entity_id: store.tenant.ownerId,
        before: { roleId: ownerRole.id, roleName: "المالك" },
        after: { roleId: accountant.id, roleName: "المحاسب" },
      }),
    ]);
    // The first owner is an accountant from their next request on.
    expectProblem(
      await call(store.owner, "POST", `/users/${second.id}/deactivate`, { reason: "x" }),
      403,
      accessProblemCodes.permissionDenied,
    );
  });

  it("keeps an owner when two owners deactivate each other at the same moment", async () => {
    const store = await newStore();
    const ownerRole = await roleNamed(store, "المالك");
    const second = await addUser(store, { roleId: ownerRole.id });
    // Each owner deactivates the other in its own transaction, both started at once. (Through
    // HTTP the first to finish would revoke the other's session before it authenticates.)
    const deactivate = (manager: string, target: string) =>
      tenants.withTenant({ tenantId: store.tenant.tenantId, userId: manager }, (tx) =>
        deactivateUser(
          tx,
          {
            tenantId: store.tenant.tenantId,
            branchId: store.tenant.branchId,
            userId: manager,
            at: clock.now(),
            isOwner: true,
            permissions: [],
            limits: {},
          },
          target,
          "race",
          dependencies,
        ),
      );
    const outcomes = await Promise.allSettled([
      deactivate(store.tenant.ownerId, second.id),
      deactivate(second.id, store.tenant.ownerId),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = outcomes.find((outcome) => outcome.status === "rejected");
    expect(refused?.reason).toMatchObject({ code: accessProblemCodes.lastOwner });
    const { rows } = await superuser.query<{ active: string }>(
      `select count(*) as active from core_access.users u join core_access.roles r on r.id = u.role_id
       where u.tenant_id = $1 and r.is_owner and u.status = 'active'`,
      [store.tenant.tenantId],
    );
    expect(rows[0]?.active).toBe("1");
  });

  it("lets only owners grant the owner role or manage an owner", async () => {
    const store = await newStore();
    const ownerRole = await roleNamed(store, "المالك");
    const accountant = await roleNamed(store, "المحاسب");
    await createStaffUser(
      tenants,
      store.tenant,
      { login: "manager", permissions: ["access.users.manage", "access.users.view"] },
      dependencies,
    );
    const manager = await signInAs(server, store.tenant, "manager");
    const owner = store.tenant.ownerId;

    expectProblem(
      await postUser(manager, { name: "x", roleId: ownerRole.id }),
      403,
      accessProblemCodes.ownersOnly,
    );
    const clerk = await addUser(store, { roleId: accountant.id });
    expectProblem(
      await call(manager, "PATCH", `/users/${clerk.id}`, { roleId: ownerRole.id }),
      403,
      accessProblemCodes.ownersOnly,
    );
    for (const [method, url, body] of [
      ["PATCH", `/users/${owner}`, { name: "x" }],
      ["POST", `/users/${owner}/deactivate`, { reason: "x" }],
      ["PUT", `/users/${owner}/pin`, { pin: "2580" }],
      ["PUT", `/users/${owner}/password`, { password: STAFF_PASSWORD }],
    ] as const) {
      expectProblem(await call(manager, method, url, body), 403, accessProblemCodes.ownersOnly);
    }

    // A manager does manage everyone else.
    const renamed = await call(manager, "PATCH", `/users/${clerk.id}`, { name: "كاتب" });
    expect(renamed.statusCode).toBe(200);
    // And an owner may make another owner.
    const promoted = await call(store.owner, "PATCH", `/users/${clerk.id}`, {
      roleId: ownerRole.id,
    });
    expect(promoted.json()).toMatchObject({ role: { isOwner: true }, departmentScope: "all" });
  });
});

describe("editing, deactivating, and reactivating users", () => {
  it("audits name, role, and scope changes on their own, with both sides", async () => {
    const store = await newStore();
    const cashier = await roleNamed(store, "كاشير القسم");
    const user = await addUser(store, { roleId: cashier.id, login: "rami" });
    const response = await call(store.owner, "PATCH", `/users/${user.id}`, {
      name: "رامي",
      departmentScope: "listed",
      departments: [store.tenant.defaultDepartmentId],
    });
    expect(response.statusCode, response.body).toBe(200);
    const changed = await auditOf(store.tenant.tenantId, "access.user.changed");
    expect(changed.at(-1)).toMatchObject({
      entity_id: user.id,
      before: { name: user.name, login: "rami" },
      after: { name: "رامي", login: "rami" },
    });
    expect((await auditOf(store.tenant.tenantId, "access.user.scopeChanged")).at(-1)).toMatchObject(
      {
        before: { departmentScope: "all", departments: [] },
        after: { departmentScope: "listed", departments: [store.tenant.defaultDepartmentId] },
      },
    );
    expect(await auditOf(store.tenant.tenantId, "access.user.roleChanged")).toEqual([]);
  });

  it("refuses a taken login, and removing the login of a user with a password", async () => {
    const store = await newStore();
    const roleId = (await roleNamed(store, "المحاسب")).id;
    const user = await addUser(store, { roleId, login: "nour", password: STAFF_PASSWORD });
    expectProblem(
      await call(store.owner, "PATCH", `/users/${user.id}`, { login: "ahmad" }),
      409,
      accessProblemCodes.loginTaken,
    );
    expectProblem(
      await call(store.owner, "PATCH", `/users/${user.id}`, { login: null }),
      422,
      accessProblemCodes.loginRequired,
    );
  });

  it("deactivates with a reason, ends the user's sessions and sign-in, then reactivates", async () => {
    const store = await newStore();
    const roleId = (await roleNamed(store, "المحاسب")).id;
    const user = await addUser(store, { roleId, login: "hala", password: STAFF_PASSWORD });
    const token = await signInAs(server, store.tenant, "hala");
    expect(await sessionStatus(token)).toBe(200);

    const response = await call(store.owner, "POST", `/users/${user.id}/deactivate`, {
      reason: "  ترك العمل  ",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "deactivated" });
    expect(await sessionStatus(token)).toBe(401);
    await expect(signInAs(server, store.tenant, "hala")).rejects.toThrow(/401/);
    expect(await auditOf(store.tenant.tenantId, "access.user.deactivated")).toEqual([
      expect.objectContaining({
        entity_id: user.id,
        created_by: store.tenant.ownerId,
        before: { status: "active" },
        after: { status: "deactivated" },
        reason: "ترك العمل",
      }),
    ]);
    const revoked = await auditOf(store.tenant.tenantId, "access.session.revoked");
    expect(revoked.at(-1)).toMatchObject({ after: { userId: user.id } });
    expectProblem(
      await call(store.owner, "POST", `/users/${user.id}/deactivate`, { reason: "again" }),
      409,
      accessProblemCodes.userDeactivated,
    );
    expect((await call(store.owner, "POST", `/users/${user.id}/deactivate`, {})).statusCode).toBe(
      400,
    );

    const reactivated = await call(store.owner, "POST", `/users/${user.id}/reactivate`);
    expect(reactivated.json()).toMatchObject({ status: "active" });
    expect(await auditOf(store.tenant.tenantId, "access.user.reactivated")).toHaveLength(1);
    await signInAs(server, store.tenant, "hala");
    expectProblem(
      await call(store.owner, "POST", `/users/${user.id}/reactivate`),
      409,
      accessProblemCodes.userActive,
    );
  });

  it("reactivates only into an active role", async () => {
    const store = await newStore();
    const copy = await call(store.owner, "POST", "/roles", { name: "مؤقت", permissions: [] });
    const role = copy.json<RoleView>();
    const user = await addUser(store, { roleId: role.id });
    await call(store.owner, "POST", `/users/${user.id}/deactivate`, { reason: "season over" });
    expect((await call(store.owner, "POST", `/roles/${role.id}/archive`)).statusCode).toBe(200);
    expectProblem(
      await call(store.owner, "POST", `/users/${user.id}/reactivate`),
      409,
      accessProblemCodes.roleArchived,
    );
  });

  it("lists users with their role and status, never a secret", async () => {
    const store = await newStore();
    await addUser(store, { roleId: (await roleNamed(store, "المحاسب")).id, login: "lina" });
    const response = await call(store.owner, "GET", "/users");
    const items = response.json<{ items: UserView[] }>().items;
    expect(items.map((u) => u.login).sort()).toEqual(["ahmad", "lina"]);
    expect(items.find((u) => u.login === "ahmad")).toMatchObject({
      role: { isOwner: true },
      hasPassword: true,
      hasPin: false,
    });
    expect(response.body).not.toContain("argon2");
  });
});

describe("PINs and passwords", () => {
  it("lets a manager set a PIN and reset a password, which ends that user's sessions", async () => {
    const store = await newStore();
    const roleId = (await roleNamed(store, "المحاسب")).id;
    const user = await addUser(store, { roleId, login: "ward", password: STAFF_PASSWORD });
    const before = (await storedUser(user.id)).pin_verifier;
    const token = await signInAs(server, store.tenant, "ward");

    expect(
      (await call(store.owner, "PUT", `/users/${user.id}/pin`, { pin: "8025" })).statusCode,
    ).toBe(200);
    expect((await storedUser(user.id)).pin_verifier).not.toBe(before);
    expect(await sessionStatus(token)).toBe(200);
    expect(
      (await call(store.owner, "PUT", `/users/${user.id}/pin`, { pin: "0000" })).statusCode,
    ).toBe(400);

    const reset = await call(store.owner, "PUT", `/users/${user.id}/password`, {
      password: "a brand new long password",
    });
    expect(reset.statusCode).toBe(200);
    expect(await sessionStatus(token)).toBe(401);
    await signInAs(server, store.tenant, "ward", "a brand new long password");
    expect(await auditOf(store.tenant.tenantId, "access.user.pinSet")).toHaveLength(1);
    expect(await auditOf(store.tenant.tenantId, "access.user.passwordSet")).toEqual([
      expect.objectContaining({ before: { hasPassword: true }, after: { hasPassword: true } }),
    ]);
  });

  it("refuses a password for a user without a login", async () => {
    const store = await newStore();
    const user = await addUser(store, { roleId: (await roleNamed(store, "المحاسب")).id });
    expectProblem(
      await call(store.owner, "PUT", `/users/${user.id}/password`, { password: STAFF_PASSWORD }),
      422,
      accessProblemCodes.loginRequired,
    );
  });

  it("lets a user change their own PIN with the current one, or with the password while they have none", async () => {
    const store = await newStore();
    // The first owner has no PIN: the password proves them.
    expectProblem(
      await call(store.owner, "PUT", "/me/pin", { currentPassword: "wrong password", pin: "2580" }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expect(
      (
        await call(store.owner, "PUT", "/me/pin", {
          currentPassword: OWNER_PASSWORD,
          pin: "2580",
        })
      ).statusCode,
    ).toBe(204);
    // Now the PIN is what proves them; the password no longer does.
    expectProblem(
      await call(store.owner, "PUT", "/me/pin", { currentPassword: OWNER_PASSWORD, pin: "9173" }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expectProblem(
      await call(store.owner, "PUT", "/me/pin", { currentPin: "0852", pin: "9173" }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expect(
      (await call(store.owner, "PUT", "/me/pin", { currentPin: "2580", pin: "9173" })).statusCode,
    ).toBe(204);
    expect(
      (await call(store.owner, "PUT", "/me/pin", { currentPin: "9173", pin: "1234" })).statusCode,
    ).toBe(400);
    expect(await auditOf(store.tenant.tenantId, "access.user.pinChanged")).toEqual([
      expect.objectContaining({ before: { hasPin: false }, after: { hasPin: true } }),
      expect.objectContaining({ before: { hasPin: true }, after: { hasPin: true } }),
    ]);
  });

  it("lets a user change their own password with the current one", async () => {
    const store = await newStore();
    expectProblem(
      await call(store.owner, "PUT", "/me/password", {
        currentPassword: "not my password",
        password: "another long password",
      }),
      403,
      accessProblemCodes.currentSecretWrong,
    );
    expect(
      (
        await call(store.owner, "PUT", "/me/password", {
          currentPassword: OWNER_PASSWORD,
          password: "another long password",
        })
      ).statusCode,
    ).toBe(204);
    await signInAs(server, store.tenant, "ahmad", "another long password");
    expect(await auditOf(store.tenant.tenantId, "access.user.passwordChanged")).toHaveLength(1);
  });

  it("stores only Argon2id hashes: the database refuses anything else", async () => {
    const store = await newStore();
    await expect(
      superuser.query(
        "update core_access.users set pin_verifier = '2580', pin_changed_at = now() where id = $1",
        [store.tenant.ownerId],
      ),
    ).rejects.toThrow(/users_pin_argon2id/);
    await expect(
      superuser.query("update core_access.users set password_hash = 'plain' where id = $1", [
        store.tenant.ownerId,
      ]),
    ).rejects.toThrow(/users_password_argon2id/);
    await expect(hashPassword("short")).rejects.toThrow();
  });
});

describe("roles (flow 7)", () => {
  it("copies a role, edits it with before and after audited, and archives it", async () => {
    const store = await newStore();
    const created = await call(store.owner, "POST", "/roles", {
      name: "كاشير المساء",
      permissions: ["sales.invoice.create", "inventory.products.view"],
    });
    expect(created.statusCode, created.body).toBe(201);
    const role = created.json<RoleView>();
    expect(role).toMatchObject({
      template: null,
      isOwner: false,
      permissions: ["inventory.products.view", "sales.invoice.create"],
      activeUsers: 0,
    });

    const edited = await call(store.owner, "PUT", `/roles/${role.id}`, {
      name: "كاشير الليل",
      permissions: ["sales.invoice.create"],
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await auditOf(store.tenant.tenantId, "access.role.changed")).toEqual([
      expect.objectContaining({
        entity_id: role.id,
        created_by: store.tenant.ownerId,
        before: {
          name: "كاشير المساء",
          permissions: ["inventory.products.view", "sales.invoice.create"],
          limits: {},
        },
        after: { name: "كاشير الليل", permissions: ["sales.invoice.create"], limits: {} },
      }),
    ]);
    // Saving it unchanged records nothing.
    await call(store.owner, "PUT", `/roles/${role.id}`, {
      name: "كاشير الليل",
      permissions: ["sales.invoice.create"],
    });
    expect(await auditOf(store.tenant.tenantId, "access.role.changed")).toHaveLength(1);

    const archived = await call(store.owner, "POST", `/roles/${role.id}/archive`);
    expect(archived.json()).toMatchObject({ archivedAt: clock.now().toISOString() });
    expect(await auditOf(store.tenant.tenantId, "access.role.archived")).toHaveLength(1);
    expectProblem(
      await call(store.owner, "PUT", `/roles/${role.id}`, { name: "x", permissions: [] }),
      409,
      accessProblemCodes.roleArchived,
    );
  });

  it("applies a role change to its users' next request", async () => {
    const store = await newStore();
    const role = (
      await call(store.owner, "POST", "/roles", { name: "مخزن", permissions: [] })
    ).json<RoleView>();
    await addUser(store, { roleId: role.id, login: "store1", password: STAFF_PASSWORD });
    const token = await signInAs(server, store.tenant, "store1");
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/v1/inventory/products",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(403);
    await call(store.owner, "PUT", `/roles/${role.id}`, {
      name: "مخزن",
      permissions: ["inventory.products.view"],
    });
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/v1/inventory/products",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("never edits or archives the owner role", async () => {
    const store = await newStore();
    const owner = await roleNamed(store, "المالك");
    expect(owner.permissions).toEqual([...serverPermissions().permissions.keys()].sort());
    expectProblem(
      await call(store.owner, "PUT", `/roles/${owner.id}`, { name: "x", permissions: [] }),
      409,
      accessProblemCodes.ownerRoleFixed,
    );
    expectProblem(
      await call(store.owner, "POST", `/roles/${owner.id}/archive`),
      409,
      accessProblemCodes.ownerRoleFixed,
    );
  });

  it("refuses to archive a role an active user holds, a taken name, and undeclared permissions", async () => {
    const store = await newStore();
    const accountant = await roleNamed(store, "المحاسب");
    await addUser(store, { roleId: accountant.id });
    expectProblem(
      await call(store.owner, "POST", `/roles/${accountant.id}/archive`),
      409,
      accessProblemCodes.roleInUse,
    );
    expectProblem(
      await call(store.owner, "POST", "/roles", { name: " المحاسب ", permissions: [] }),
      409,
      accessProblemCodes.roleNameTaken,
    );
    expectProblem(
      await call(store.owner, "POST", "/roles", { name: "x", permissions: ["repairs.job.close"] }),
      422,
      accessProblemCodes.roleInvalid,
    );
    expectProblem(
      await call(store.owner, "PUT", `/roles/${newId()}`, { name: "x", permissions: [] }),
      404,
      accessProblemCodes.roleNotFound,
    );
  });

  it("serves the catalogue of declared permissions and limits", async () => {
    const store = await newStore();
    const response = await call(store.owner, "GET", "/catalogue");
    const catalogue = response.json<{
      permissions: { id: string; moduleId: string; scoped: boolean }[];
      limits: unknown[];
    }>();
    expect(catalogue.permissions).toContainEqual({
      id: "sales.invoice.create",
      moduleId: "sales",
      scoped: true,
    });
    expect(catalogue.permissions).toContainEqual({
      id: "access.users.manage",
      moduleId: "core.access",
      scoped: false,
    });
    expect(catalogue.limits).toEqual([]);
  });
});

describe("permissions declared after a tenant exists (slice 6 decision)", () => {
  /** The server's catalogue plus a later module granting the section cashier more. */
  const later: PermissionCatalogue = {
    permissions: new Map([
      ...serverPermissions().permissions,
      [
        "repairs.job.close",
        {
          id: "repairs.job.close",
          moduleId: "repairs",
          scoped: true,
          grants: ["sectionCashier"],
        },
      ],
    ]),
    limits: new Map([
      [
        "repairs.discount.maxPercent",
        {
          id: "repairs.discount.maxPercent",
          moduleId: "repairs",
          kind: "percent" as const,
          grants: { sectionCashier: "5" },
        },
      ],
    ]),
  };

  function accessOf(store: Store, userId: string, catalogue: PermissionCatalogue) {
    return tenants.withTenant({ tenantId: store.tenant.tenantId }, async (tx) => {
      const access = await userAccess(tx, userId, catalogue);
      if (access === undefined) throw new Error("no user");
      return access;
    });
  }

  const holds = (access: UserAccess) => ({
    permissions: access.access.permissions,
    limits: access.access.limits,
  });

  it("reaches roles seeded from the template, not copies, and a removal stays removed", async () => {
    const store = await newStore();
    const cashier = await roleNamed(store, "كاشير القسم");
    const copy = (
      await call(store.owner, "POST", "/roles", {
        name: "نسخة الكاشير",
        permissions: cashier.permissions,
      })
    ).json<RoleView>();
    const seededUser = await addUser(store, { roleId: cashier.id });
    const copyUser = await addUser(store, { roleId: copy.id });

    expect(holds(await accessOf(store, seededUser.id, later))).toEqual({
      permissions: ["inventory.products.view", "repairs.job.close", "sales.invoice.create"],
      limits: { "repairs.discount.maxPercent": "5" },
    });
    expect(holds(await accessOf(store, copyUser.id, later))).toEqual({
      permissions: ["inventory.products.view", "sales.invoice.create"],
      limits: {},
    });

    // The owner removes the new permission and lowers nothing else.
    await tenants.withTenant(
      { tenantId: store.tenant.tenantId, userId: store.tenant.ownerId },
      (tx) =>
        editRole(
          tx,
          {
            tenantId: store.tenant.tenantId,
            branchId: store.tenant.branchId,
            userId: store.tenant.ownerId,
            at: clock.now(),
            isOwner: true,
            permissions: [],
            limits: {},
          },
          {
            id: cashier.id,
            name: cashier.name,
            permissions: ["sales.invoice.create"],
            limits: { "repairs.discount.maxPercent": "5" },
          },
          later,
          dependencies,
        ),
    );
    expect(holds(await accessOf(store, seededUser.id, later))).toEqual({
      permissions: ["sales.invoice.create"],
      limits: { "repairs.discount.maxPercent": "5" },
    });

    // A grant declared after that edit still arrives.
    const evenLater: PermissionCatalogue = {
      permissions: new Map([
        ...later.permissions,
        [
          "repairs.job.open",
          { id: "repairs.job.open", moduleId: "repairs", scoped: true, grants: ["sectionCashier"] },
        ],
      ]),
      limits: later.limits,
    };
    expect(holds(await accessOf(store, seededUser.id, evenLater)).permissions).toEqual([
      "repairs.job.open",
      "sales.invoice.create",
    ]);
  });
});

describe("a non-owner grants nothing beyond their own (slice 6 decision)", () => {
  /** A store with a non-owner manager whose role holds the manage permissions and one more. */
  async function withManager() {
    const store = await newStore();
    const staff = await createStaffUser(
      tenants,
      store.tenant,
      {
        login: "deputy",
        permissions: [
          "access.users.view",
          "access.users.manage",
          "access.roles.manage",
          "inventory.products.view",
        ],
      },
      dependencies,
    );
    return { store, staff, deputy: await signInAs(server, store.tenant, "deputy") };
  }

  it("copies and edits roles only within the permissions the manager holds", async () => {
    const { store, deputy } = await withManager();
    expectProblem(
      await call(deputy, "POST", "/roles", { name: "مراقب", permissions: ["audit.view"] }),
      403,
      accessProblemCodes.beyondOwnGrant,
    );
    const created = await call(deputy, "POST", "/roles", {
      name: "مخزن",
      permissions: ["inventory.products.view"],
    });
    expect(created.statusCode, created.body).toBe(201);
    const role = created.json<RoleView>();
    expectProblem(
      await call(deputy, "PUT", `/roles/${role.id}`, {
        name: "مخزن",
        permissions: ["inventory.products.view", "sales.invoices.view"],
      }),
      403,
      accessProblemCodes.beyondOwnGrant,
    );
    // What a role already holds may stay, and may be removed, even if the manager lacks it.
    const accountant = await roleNamed(store, "المحاسب");
    expect(accountant.permissions).toContain("audit.view");
    const renamed = await call(deputy, "PUT", `/roles/${accountant.id}`, {
      name: "محاسب المتجر",
      permissions: accountant.permissions,
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const trimmed = await call(deputy, "PUT", `/roles/${accountant.id}`, {
      name: "محاسب المتجر",
      permissions: accountant.permissions.filter((p) => p !== "audit.view"),
    });
    expect(trimmed.statusCode, trimmed.body).toBe(200);
  });

  it("gives users only roles within what the manager holds", async () => {
    const { store, deputy } = await withManager();
    const accountant = await roleNamed(store, "المحاسب");
    expectProblem(
      await postUser(deputy, { name: "x", roleId: accountant.id }),
      403,
      accessProblemCodes.beyondOwnGrant,
    );
    const small = (
      await call(deputy, "POST", "/roles", {
        name: "عرض المنتجات",
        permissions: ["inventory.products.view"],
      })
    ).json<RoleView>();
    const user = await postUser(deputy, { name: "عامل", roleId: small.id });
    expect(user.statusCode, user.body).toBe(201);
    expectProblem(
      await call(deputy, "PATCH", `/users/${user.json<UserView>().id}`, {
        roleId: accountant.id,
      }),
      403,
      accessProblemCodes.beyondOwnGrant,
    );
  });

  it("does not let a non-owner change their own role or departments", async () => {
    const { store, staff, deputy } = await withManager();
    const small = (
      await call(deputy, "POST", "/roles", { name: "أصغر", permissions: [] })
    ).json<RoleView>();
    expectProblem(
      await call(deputy, "PATCH", `/users/${staff.userId}`, { roleId: small.id }),
      403,
      accessProblemCodes.ownAccessChange,
    );
    expectProblem(
      await call(deputy, "PATCH", `/users/${staff.userId}`, {
        departmentScope: "listed",
        departments: [store.tenant.defaultDepartmentId],
      }),
      403,
      accessProblemCodes.ownAccessChange,
    );
    const renamed = await call(deputy, "PATCH", `/users/${staff.userId}`, { name: "النائب" });
    expect(renamed.statusCode, renamed.body).toBe(200);
  });

  it("changes one's own PIN or password only from one's account, owners included", async () => {
    const { store, staff, deputy } = await withManager();
    expectProblem(
      await call(deputy, "PUT", `/users/${staff.userId}/pin`, { pin: "2580" }),
      409,
      accessProblemCodes.useOwnAccount,
    );
    expectProblem(
      await call(store.owner, "PUT", `/users/${store.tenant.ownerId}/password`, {
        password: STAFF_PASSWORD,
      }),
      409,
      accessProblemCodes.useOwnAccount,
    );
    expectProblem(
      await call(store.owner, "PUT", `/users/${store.tenant.ownerId}/pin`, { pin: "2580" }),
      409,
      accessProblemCodes.useOwnAccount,
    );
  });

  it("raises no limit value beyond the manager's own", async () => {
    const store = await newStore();
    const catalogue: PermissionCatalogue = {
      permissions: serverPermissions().permissions,
      limits: new Map([
        [
          "fixture.discount.max",
          { id: "fixture.discount.max", moduleId: "fixture", kind: "percent" as const, grants: {} },
        ],
      ]),
    };
    const role = (
      await call(store.owner, "POST", "/roles", { name: "خصومات", permissions: [] })
    ).json<RoleView>();
    const edit = (manager: { isOwner: boolean; limits: Record<string, string> }, value: string) =>
      tenants.withTenant({ tenantId: store.tenant.tenantId, userId: store.tenant.ownerId }, (tx) =>
        editRole(
          tx,
          {
            tenantId: store.tenant.tenantId,
            branchId: store.tenant.branchId,
            userId: store.tenant.ownerId,
            at: clock.now(),
            permissions: [],
            ...manager,
          },
          {
            id: role.id,
            name: "خصومات",
            permissions: [],
            limits: { "fixture.discount.max": value },
          },
          catalogue,
          dependencies,
        ),
      );
    const deputy = { isOwner: false, limits: { "fixture.discount.max": "10" } };
    await expect(edit(deputy, "10.5")).rejects.toMatchObject({
      code: accessProblemCodes.beyondOwnGrant,
    });
    expect((await edit(deputy, "10")).limits).toEqual({ "fixture.discount.max": "10" });
    // An owner set it higher; the deputy may lower it, though not to above their own.
    await edit({ isOwner: true, limits: {} }, "20");
    expect((await edit(deputy, "15")).limits).toEqual({ "fixture.discount.max": "15" });
    await expect(edit({ isOwner: false, limits: {} }, "16")).rejects.toMatchObject({
      code: accessProblemCodes.beyondOwnGrant,
    });
  });
});

describe("limit values on roles", () => {
  it("reads a value back in one spelling and audits no change for another spelling of it", async () => {
    const store = await newStore();
    const catalogue: PermissionCatalogue = {
      permissions: serverPermissions().permissions,
      limits: new Map([
        [
          "fixture.discount.max",
          {
            id: "fixture.discount.max",
            moduleId: "fixture",
            kind: "percent" as const,
            grants: {},
          },
        ],
      ]),
    };
    const role = (
      await call(store.owner, "POST", "/roles", { name: "خصم", permissions: [] })
    ).json<RoleView>();
    const edit = (value: string) =>
      tenants.withTenant({ tenantId: store.tenant.tenantId, userId: store.tenant.ownerId }, (tx) =>
        editRole(
          tx,
          {
            tenantId: store.tenant.tenantId,
            branchId: store.tenant.branchId,
            userId: store.tenant.ownerId,
            at: clock.now(),
            isOwner: true,
            permissions: [],
            limits: {},
          },
          { id: role.id, name: "خصم", permissions: [], limits: { "fixture.discount.max": value } },
          catalogue,
          dependencies,
        ),
      );
    expect((await edit("5.50")).limits).toEqual({ "fixture.discount.max": "5.5" });
    for (const same of ["05.5", "5.5000", "005.50"]) {
      expect((await edit(same)).limits).toEqual({ "fixture.discount.max": "5.5" });
    }
    expect((await edit("00")).limits).toEqual({ "fixture.discount.max": "0" });
    expect(await auditOf(store.tenant.tenantId, "access.role.changed")).toHaveLength(2);
  });
});

describe("the users and roles routes' permissions", () => {
  it("lets access.users.view read, and nothing more", async () => {
    const store = await newStore();
    await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer", permissions: ["access.users.view"] },
      dependencies,
    );
    const viewer = await signInAs(server, store.tenant, "viewer");
    expect((await call(viewer, "GET", "/users")).statusCode).toBe(200);
    expect((await call(viewer, "GET", "/roles")).statusCode).toBe(200);
    expectProblem(
      await call(viewer, "POST", "/roles", { name: "x", permissions: [] }),
      403,
      accessProblemCodes.permissionDenied,
    );
    expectProblem(
      await postUser(viewer, { name: "x", roleId: newId() }),
      403,
      accessProblemCodes.permissionDenied,
    );
    // Their own PIN needs no permission.
    expect(
      (await call(viewer, "PUT", "/me/pin", { currentPassword: STAFF_PASSWORD, pin: "2580" }))
        .statusCode,
    ).toBe(204);
  });
});
