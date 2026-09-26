import { createHash } from "node:crypto";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import {
  type DepartmentView,
  LOGO_MAX_BYTES,
  organizationProblemCodes,
  type StoreProfileView,
} from "@mustawfi/core-organization/shared";
import { DEFAULT_DEPARTMENT_NAME, tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHostServer } from "./host-server.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createServerRegistry } from "./modules.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-25T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

/** A PNG and a JPEG by their signatures, which is what the server checks. */
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array<number>(24).fill(7),
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(24).fill(9)]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array<number>(24).fill(1)]);

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
}

beforeAll(async () => {
  database = await createTestDatabase("organization");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  const registry = createServerRegistry();
  server = await buildHostServer({
    registry,
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

async function newStore(name: string, departments = 3): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
    { limits: { departments } },
  );
  const login = await server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  return { tenant, token: login.json<{ token: string }>().token };
}

function call(
  store: Store | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return server.inject({
    method,
    url: `/api/v1/organization${url}`,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    ...(store === null ? {} : { headers: { authorization: `Bearer ${store.token}` } }),
  });
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(response.json()).toMatchObject({ status, code });
}

async function departments(store: Store): Promise<DepartmentView[]> {
  const response = await call(store, "GET", "/departments");
  expect(response.statusCode).toBe(200);
  return response.json<{ items: DepartmentView[] }>().items;
}

async function addDepartment(store: Store, name: string): Promise<DepartmentView> {
  const response = await call(store, "POST", "/departments", { name });
  expect(response.statusCode).toBe(201);
  return response.json<DepartmentView>();
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    entity_id: string;
    before: unknown;
    after: unknown;
    created_by: string;
  }>(
    `select entity_id, before, after, created_by from core_audit.entries
      where tenant_id = $1 and action = $2 order by id`,
    [tenantId, action],
  );
  return rows;
}

describe("a new tenant", () => {
  it("gets its default department «المتجر» and a store profile named after it, audited", async () => {
    const store = await newStore("متجر النور");
    expect(await departments(store)).toEqual([
      {
        id: store.tenant.defaultDepartmentId,
        name: DEFAULT_DEPARTMENT_NAME,
        isDefault: true,
        sortOrder: 0,
        archivedAt: null,
      },
    ]);
    const profile = await call(store, "GET", "/profile");
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      name: "متجر النور",
      address: null,
      phones: [],
      taxNumber: null,
      commercialRegister: null,
      logo: null,
    });
    const { tenantId, ownerId } = store.tenant;
    expect(await auditOf(tenantId, "organization.department.created")).toEqual([
      expect.objectContaining({ entity_id: store.tenant.defaultDepartmentId, created_by: ownerId }),
    ]);
    const created = await auditOf(tenantId, "organization.profile.created");
    expect(created).toHaveLength(1);
    expect(created).toMatchObject([{ after: { name: "متجر النور" } }]);
  });
});

describe("departments", () => {
  it("are created in order within the license's limit; archived ones do not count", async () => {
    const store = await newStore("متجر الأقسام", 3);
    const repairs = await addDepartment(store, "الصيانة");
    const accessories = await addDepartment(store, "الإكسسوارات");
    expect([repairs.sortOrder, accessories.sortOrder]).toEqual([1, 2]);
    expectProblem(
      await call(store, "POST", "/departments", { name: "التحويلات" }),
      409,
      tenancyProblemCodes.departmentLimit,
    );

    const archived = await call(store, "POST", `/departments/${repairs.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      id: repairs.id,
      archivedAt: clock.now().toISOString(),
    });
    // Archiving freed a place and the name: an archived department's name can be reused.
    const again = await addDepartment(store, "الصيانة");
    expect(again.sortOrder).toBe(3);
    expect((await departments(store)).map((d) => [d.name, d.archivedAt === null])).toEqual([
      [DEFAULT_DEPARTMENT_NAME, true],
      ["الصيانة", false],
      ["الإكسسوارات", true],
      ["الصيانة", true],
    ]);

    const [created] = await auditOf(store.tenant.tenantId, "organization.department.archived");
    expect(created).toMatchObject({
      entity_id: repairs.id,
      before: { archivedAt: null },
      after: { archivedAt: clock.now().toISOString() },
    });
  });

  it("refuses a second active department with the same name", async () => {
    const store = await newStore("متجر الأسماء");
    await addDepartment(store, "الصيانة");
    expectProblem(
      await call(store, "POST", "/departments", { name: " الصيانة " }),
      409,
      tenancyProblemCodes.departmentNameTaken,
    );
    expectProblem(
      await call(store, "PATCH", `/departments/${store.tenant.defaultDepartmentId}`, {
        name: "الصيانة",
      }),
      409,
      tenancyProblemCodes.departmentNameTaken,
    );
  });

  it("renames active departments, the default included, audited with before and after", async () => {
    const store = await newStore("متجر التسمية");
    const renamed = await call(store, "PATCH", `/departments/${store.tenant.defaultDepartmentId}`, {
      name: "المحل",
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "المحل", isDefault: true });
    const renames = await auditOf(store.tenant.tenantId, "organization.department.renamed");
    expect(renames).toHaveLength(1);
    expect(renames).toMatchObject([
      { before: { name: DEFAULT_DEPARTMENT_NAME }, after: { name: "المحل" } },
    ]);

    const repairs = await addDepartment(store, "الصيانة");
    await call(store, "POST", `/departments/${repairs.id}/archive`);
    expectProblem(
      await call(store, "PATCH", `/departments/${repairs.id}`, { name: "الصيانة القديمة" }),
      409,
      tenancyProblemCodes.departmentArchived,
    );
    expectProblem(
      await call(store, "POST", `/departments/${repairs.id}/archive`),
      409,
      tenancyProblemCodes.departmentArchived,
    );
  });

  it("never archives the last active department or the default one", async () => {
    const store = await newStore("متجر الأرشفة");
    const defaultUrl = `/departments/${store.tenant.defaultDepartmentId}/archive`;
    expectProblem(
      await call(store, "POST", defaultUrl),
      409,
      tenancyProblemCodes.lastActiveDepartment,
    );
    const repairs = await addDepartment(store, "الصيانة");
    expectProblem(
      await call(store, "POST", defaultUrl),
      409,
      tenancyProblemCodes.defaultDepartment,
    );
    expect((await call(store, "POST", `/departments/${repairs.id}/archive`)).statusCode).toBe(200);
    expect((await departments(store)).filter((d) => d.archivedAt === null)).toHaveLength(1);

    // The database keeps the default too: it can be neither archived nor made ordinary.
    await expect(
      superuser.query(
        `update core_tenancy.departments set archived_at = now(), archived_by = created_by
          where id = $1`,
        [store.tenant.defaultDepartmentId],
      ),
    ).rejects.toThrow(/departments_default_not_archived/);
    await expect(
      superuser.query(`update core_tenancy.departments set is_default = false where id = $1`, [
        store.tenant.defaultDepartmentId,
      ]),
    ).rejects.toThrow(/the default department never changes/);
  });

  it("keeps each tenant to its own departments", async () => {
    const mine = await newStore("متجري");
    const theirs = await newStore("متجرهم");
    const their = await addDepartment(theirs, "الصيانة");
    expect((await departments(mine)).map((d) => d.id)).not.toContain(their.id);
    expectProblem(
      await call(mine, "PATCH", `/departments/${their.id}`, { name: "لي" }),
      404,
      tenancyProblemCodes.departmentNotFound,
    );
    expectProblem(
      await call(mine, "POST", `/departments/${their.id}/archive`),
      404,
      tenancyProblemCodes.departmentNotFound,
    );
  });

  it("are changed only with organization.departments.manage and organization.profile.edit", async () => {
    const owner = await newStore("متجر الموظف");
    const repairs = await addDepartment(owner, "الصيانة");
    const staff = async (login: string, permissions: string[]): Promise<Store> => {
      await createStaffUser(tenants, owner.tenant, { login, permissions }, dependencies);
      return { tenant: owner.tenant, token: await signInAs(server, owner.tenant, login) };
    };
    const png = { data: Buffer.from(PNG).toString("base64") };
    const departmentWrites = (store: Store) => [
      call(store, "POST", "/departments", { name: "الإكسسوارات" }),
      call(store, "PATCH", `/departments/${repairs.id}`, { name: "الورشة" }),
      call(store, "POST", `/departments/${repairs.id}/archive`),
    ];
    const profileWrites = (store: Store) => [
      call(store, "PUT", "/profile", { name: "متجر" }),
      call(store, "PUT", "/profile/logo", png),
      call(store, "DELETE", "/profile/logo"),
    ];

    const profileEditor = await staff("editor", ["organization.profile.edit"]);
    for (const response of await Promise.all(departmentWrites(profileEditor))) {
      expectProblem(response, 403, accessProblemCodes.permissionDenied);
    }
    for (const response of await Promise.all(profileWrites(profileEditor))) {
      expect(response.statusCode).toBe(200);
    }
    const manager = await staff("manager", ["organization.departments.manage"]);
    for (const response of await Promise.all(profileWrites(manager))) {
      expectProblem(response, 403, accessProblemCodes.permissionDenied);
    }
    expect((await call(manager, "POST", "/departments", { name: "الإكسسوارات" })).statusCode).toBe(
      201,
    );

    // Reading stays open to every signed-in user, whatever their role.
    const nobody = await staff("nobody", []);
    expect((await call(nobody, "GET", "/departments")).statusCode).toBe(200);
    expect((await call(nobody, "GET", "/profile")).statusCode).toBe(200);
  });

  it("needs a session, and a valid name", async () => {
    const store = await newStore("متجر التحقق");
    expectProblem(await call(null, "GET", "/departments"), 401, accessProblemCodes.sessionRequired);
    expectProblem(
      await call(null, "POST", "/departments", { name: "الصيانة" }),
      401,
      accessProblemCodes.sessionRequired,
    );
    expectProblem(
      await call(store, "POST", "/departments", { name: "   " }),
      400,
      hostProblemCodes.invalidRequest,
    );
  });
});

describe("the store profile", () => {
  it("is edited as a whole, audited with before and after", async () => {
    const store = await newStore("متجر الملف");
    const response = await call(store, "PUT", "/profile", {
      name: "متجر الملف الجديد",
      address: "دمشق، الحميدية",
      phones: ["+963 11 222 3333", "0944-123-456"],
      taxNumber: "123456",
      commercialRegister: "",
    });
    expect(response.statusCode).toBe(200);
    const profile = response.json<StoreProfileView>();
    expect(profile).toMatchObject({
      name: "متجر الملف الجديد",
      address: "دمشق، الحميدية",
      phones: ["+963 11 222 3333", "0944-123-456"],
      taxNumber: "123456",
      commercialRegister: null,
      logo: null,
    });
    const edits = await auditOf(store.tenant.tenantId, "organization.profile.changed");
    expect(edits).toHaveLength(1);
    expect(edits).toMatchObject([
      {
        entity_id: profile.id,
        before: { name: "متجر الملف", phones: [] },
        after: { name: "متجر الملف الجديد", taxNumber: "123456" },
      },
    ]);

    expectProblem(
      await call(store, "PUT", "/profile", {
        name: "متجر",
        phones: ["1234", "2345", "3456", "4567"],
      }),
      400,
      hostProblemCodes.invalidRequest,
    );
    expectProblem(
      await call(store, "PUT", "/profile", { name: "" }),
      400,
      hostProblemCodes.invalidRequest,
    );
  });

  it("takes a PNG or JPEG logo of at most 256 KB, checked by its content", async () => {
    const store = await newStore("متجر الشعار");
    const upload = (bytes: Uint8Array) =>
      call(store, "PUT", "/profile/logo", { data: Buffer.from(bytes).toString("base64") });

    const png = await upload(PNG);
    expect(png.statusCode).toBe(200);
    expect(png.json<StoreProfileView>().logo).toEqual({
      type: "image/png",
      sha256: createHash("sha256").update(PNG).digest("hex"),
      size: PNG.length,
    });
    const fetched = await call(store, "GET", "/profile/logo");
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
    expect(new Uint8Array(fetched.rawPayload)).toEqual(PNG);

    expect((await upload(JPEG)).json<StoreProfileView>().logo?.type).toBe("image/jpeg");
    expectProblem(await upload(GIF), 422, organizationProblemCodes.logoUnsupportedType);
    const large = new Uint8Array(LOGO_MAX_BYTES + 1);
    large.set(PNG);
    expectProblem(await upload(large), 422, organizationProblemCodes.logoTooLarge);
    const largest = new Uint8Array(LOGO_MAX_BYTES);
    largest.set(JPEG);
    expect((await upload(largest)).statusCode).toBe(200);

    const changes = await auditOf(store.tenant.tenantId, "organization.profile.changed");
    expect(changes).toHaveLength(3);
    // The audit log records which image, not its bytes.
    expect(changes[0]?.after).toMatchObject({ logo: { type: "image/png", size: PNG.length } });

    const removed = await call(store, "DELETE", "/profile/logo");
    expect(removed.json<StoreProfileView>().logo).toBeNull();
    expectProblem(
      await call(store, "GET", "/profile/logo"),
      404,
      organizationProblemCodes.logoNotFound,
    );
  });
});

describe("pull", () => {
  it("delivers the current departments and store profile to a new device", async () => {
    const store = await newStore("متجر الجهاز");
    const repairs = await addDepartment(store, "الصيانة");
    const archived = await addDepartment(store, "قديم");
    await call(store, "POST", `/departments/${archived.id}/archive`);
    await call(store, "PUT", "/profile", { name: "متجر الجهاز", phones: ["0944123456"] });
    await call(store, "PUT", "/profile/logo", { data: Buffer.from(PNG).toString("base64") });

    const issued = await server.inject({
      method: "POST",
      url: "/api/v1/access/registration-codes",
      headers: { authorization: `Bearer ${store.token}` },
    });
    const registered = await server.inject({
      method: "POST",
      url: "/api/v1/access/devices",
      payload: {
        storeCode: store.tenant.storeCode,
        registrationCode: issued.json<{ code: string }>().code,
        type: "mainPos",
        name: "الصندوق",
      },
    });
    const { credential } = registered.json<{ credential: string }>();
    const pulled = await server.inject({
      method: "GET",
      url: "/api/v1/sync/pull?limit=1000",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(pulled.statusCode).toBe(200);
    const { changes } = pulled.json<{
      changes: { entity: string; id: string; row: Record<string, unknown> | null }[];
    }>();

    // Each change carries the full row as the API shows it; archived departments included.
    const latest = new Map(changes.map((c) => [c.id, c]));
    const profile = (await call(store, "GET", "/profile")).json<StoreProfileView>();
    expect(
      [...latest.values()].filter((c) => c.entity === "organization.department").map((c) => c.row),
    ).toEqual(await departments(store));
    expect(latest.get(profile.id)).toEqual({
      entity: "organization.storeProfile",
      id: profile.id,
      row: profile,
    });
    expect(latest.get(repairs.id)?.row).toMatchObject({ name: "الصيانة", archivedAt: null });
  });
});
