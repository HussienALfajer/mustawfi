import { routeAccessTable, type RouteAccessEntry } from "@mustawfi/core-access/server";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry, serverPermissions } from "./modules.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

const clock = manualClock(new Date("2026-09-26T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let store: CreatedTenant;
let routes: readonly RouteAccessEntry[];

beforeAll(async () => {
  database = await createTestDatabase("route_access");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
  store = await createLicensedTenant(
    tenants,
    {
      name: "متجر الصلاحيات",
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: "correct horse battery staple",
    },
    dependencies,
  );
  // Fastify answers HEAD for every GET route itself, behind the same declaration.
  routes = routeAccessTable(server).filter((route) => route.method !== "HEAD");
});

afterAll(async () => {
  await server.close();
  await tenants.close();
});

const describeAccess = (access: RouteAccessEntry["access"]) =>
  typeof access === "string" ? access : access.permission;

/** A request to `route` with any path parameter filled in and an empty body. */
function request(route: RouteAccessEntry, token?: string): InjectOptions {
  const options: InjectOptions = {
    method: route.method as NonNullable<InjectOptions["method"]>,
    url: route.url.replace(/:[a-zA-Z]+/g, newId()),
  };
  if (route.method !== "GET" && route.method !== "DELETE") options.payload = {};
  if (token !== undefined) options.headers = { authorization: `Bearer ${token}` };
  return options;
}

let staffCount = 0;

/** A fresh sign-in of a new user whose role holds exactly `permissions`. */
async function tokenWith(permissions: readonly string[]): Promise<string> {
  staffCount += 1;
  const login = `staff${String(staffCount)}`;
  await createStaffUser(tenants, store, { login, permissions }, dependencies);
  return signInAs(server, store, login);
}

describe("route authorization (core-foundation rule 17)", () => {
  it("declares what every route needs, as the spec's Permissions tables say", () => {
    expect(
      routes.map((route) => `${route.method} ${route.url} → ${describeAccess(route.access)}`),
    ).toEqual([
      "GET /api/v1/health → public",
      "GET /api/v1/openapi.json → public",
      "POST /api/v1/access/login → public",
      "POST /api/v1/access/pin-login → public",
      "POST /api/v1/access/password-reset → public",
      "POST /api/v1/access/logout → session",
      "GET /api/v1/access/session → session",
      "POST /api/v1/access/registration-codes → access.devices.manage",
      "POST /api/v1/access/devices → public",
      "GET /api/v1/access/devices/current → device",
      "POST /api/v1/access/devices/current/wipe → deviceEvenRevoked",
      "GET /api/v1/access/devices → access.devices.manage",
      "POST /api/v1/access/devices/:id/revoke → access.devices.manage",
      "GET /api/v1/access/catalogue → access.users.view",
      "GET /api/v1/access/roles → access.users.view",
      "POST /api/v1/access/roles → access.roles.manage",
      "PUT /api/v1/access/roles/:id → access.roles.manage",
      "POST /api/v1/access/roles/:id/archive → access.roles.manage",
      "GET /api/v1/access/users → access.users.view",
      "POST /api/v1/access/users → access.users.manage",
      "PATCH /api/v1/access/users/:id → access.users.manage",
      "POST /api/v1/access/users/:id/deactivate → access.users.manage",
      "POST /api/v1/access/users/:id/reactivate → access.users.manage",
      "PUT /api/v1/access/users/:id/pin → access.users.manage",
      "PUT /api/v1/access/users/:id/password → access.users.manage",
      "POST /api/v1/access/users/:id/two-factor/clear → access.users.manage",
      "GET /api/v1/access/me → session",
      "POST /api/v1/access/me/two-factor/enrolment → session",
      "POST /api/v1/access/me/two-factor/confirm → session",
      "POST /api/v1/access/me/two-factor/disable → session",
      "PUT /api/v1/access/me/pin → session",
      "PUT /api/v1/access/me/password → session",
      "POST /api/v1/sync/push → deviceEvenRevoked",
      "GET /api/v1/sync/pull → device",
      "GET /api/v1/sync/bundle → device",
      "GET /api/v1/organization/departments → session",
      "POST /api/v1/organization/departments → organization.departments.manage",
      "PATCH /api/v1/organization/departments/:id → organization.departments.manage",
      "POST /api/v1/organization/departments/:id/archive → organization.departments.manage",
      "GET /api/v1/organization/profile → session",
      "PUT /api/v1/organization/profile → organization.profile.edit",
      "PUT /api/v1/organization/profile/logo → organization.profile.edit",
      "DELETE /api/v1/organization/profile/logo → organization.profile.edit",
      "GET /api/v1/organization/profile/logo → session",
      "GET /api/v1/organization/license → organization.license.view",
      "POST /api/v1/inventory/products → inventory.products.manage",
      "GET /api/v1/inventory/products → inventory.products.view",
      "GET /api/v1/sales/invoices → sales.invoices.view",
    ]);
  });

  it("answers 403 on every permission route to a user whose role lacks exactly that permission", async () => {
    const all = [...serverPermissions().permissions.keys()];
    const guarded = routes.filter((route) => typeof route.access === "object");
    expect(guarded.length).toBeGreaterThan(0);
    for (const route of guarded) {
      const needed = describeAccess(route.access);
      const lacking = await server.inject(
        request(route, await tokenWith(all.filter((p) => p !== needed))),
      );
      expect(lacking.statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(problemDetailsSchema.parse(lacking.json()).code).toBe(
        accessProblemCodes.permissionDenied,
      );
      const holding = await server.inject(request(route, await tokenWith([needed])));
      expect([401, 403], `${route.method} ${route.url} with ${needed}`).not.toContain(
        holding.statusCode,
      );
    }
  });

  it("lets a user with no permission at all through every session route", async () => {
    for (const route of routes.filter((r) => r.access === "session")) {
      const response = await server.inject(request(route, await tokenWith([])));
      expect([401, 403], `${route.method} ${route.url}`).not.toContain(response.statusCode);
    }
  });

  it("answers 401 on every non-public route without a credential", async () => {
    for (const route of routes.filter((r) => r.access !== "public")) {
      const response = await server.inject(request(route));
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it("gives the owner every declared permission in the session answer", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/access/session",
      headers: {
        authorization: `Bearer ${await signInAs(server, store, "ahmad", "correct horse battery staple")}`,
      },
    });
    expect(response.json()).toMatchObject({
      user: {
        role: { name: "المالك", isOwner: true },
        departmentScope: "all",
        departments: [],
        permissions: [...serverPermissions().permissions.keys()].sort(),
      },
    });
  });
});

describe("the session's department scope", () => {
  it("lists the user's active departments; an archived one leaves the scope (rule 28)", async () => {
    const owner = await signInAs(server, store, "ahmad", "correct horse battery staple");
    const call = (method: "GET" | "POST", url: string, token: string, payload?: object) =>
      server.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
    const added = await call("POST", "/api/v1/organization/departments", owner, {
      name: "الصيانة",
    });
    expect(added.statusCode).toBe(201);
    const repairs = added.json<{ id: string }>().id;
    await createStaffUser(
      tenants,
      store,
      { login: "technician", permissions: [], departments: [store.defaultDepartmentId, repairs] },
      dependencies,
    );
    const token = await signInAs(server, store, "technician");
    const scope = async () =>
      (await call("GET", "/api/v1/access/session", token)).json<{
        user: { departmentScope: string; departments: string[] };
      }>().user;
    expect(await scope()).toEqual(
      expect.objectContaining({
        departmentScope: "listed",
        departments: expect.arrayContaining([store.defaultDepartmentId, repairs]) as string[],
      }),
    );
    expect(
      (await call("POST", `/api/v1/organization/departments/${repairs}/archive`, owner)).statusCode,
    ).toBe(200);
    expect((await scope()).departments).toEqual([store.defaultDepartmentId]);
  });
});

describe("declared permissions", () => {
  it("are the spec's, with its scopes and template grants", () => {
    const declared = [...serverPermissions().permissions.values()].map((p) => ({
      id: p.id,
      scoped: p.scoped,
      grants: [...p.grants].sort(),
    }));
    expect(declared.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([
      { id: "access.devices.manage", scoped: false, grants: [] },
      { id: "access.roles.manage", scoped: false, grants: [] },
      { id: "access.users.manage", scoped: false, grants: [] },
      { id: "access.users.unlock", scoped: false, grants: ["accountant"] },
      { id: "access.users.view", scoped: false, grants: ["accountant"] },
      { id: "audit.view", scoped: false, grants: ["accountant"] },
      {
        id: "inventory.products.manage",
        scoped: false,
        grants: ["accountant"],
      },
      {
        id: "inventory.products.view",
        scoped: false,
        grants: ["accountant", "repairTechnician", "sectionCashier", "topUpOperator"],
      },
      { id: "organization.departments.manage", scoped: false, grants: [] },
      { id: "organization.license.view", scoped: false, grants: [] },
      { id: "organization.profile.edit", scoped: false, grants: [] },
      { id: "sales.invoice.create", scoped: true, grants: ["sectionCashier"] },
      { id: "sales.invoices.view", scoped: false, grants: ["accountant"] },
    ]);
    expect([...serverPermissions().limits.keys()]).toEqual([]);
  });
});
