import { createHash } from "node:crypto";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import {
  type DepartmentListItem,
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

async function departments(store: Store): Promise<DepartmentListItem[]> {
  const response = await call(store, "GET", "/departments");
  expect(response.statusCode).toBe(200);
  return response.json<{ items: DepartmentListItem[] }>().items;
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
        // The panel's «last changed by … on …»: its creation with the tenant, by the owner.
        lastChange: {
          entryId: expect.any(String) as string,
          at: clock.now().toISOString(),
          by: { id: store.tenant.ownerId, name: "أحمد" },
          bySupport: false,
        },
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
      logoPrint: "threshold",
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
    // Archiving freed a place, but not the name (slice 20): that one is restored instead.
    const again = await addDepartment(store, "التحويلات");
    expect(again.sortOrder).toBe(3);
    expect((await departments(store)).map((d) => [d.name, d.archivedAt === null])).toEqual([
      [DEFAULT_DEPARTMENT_NAME, true],
      ["الصيانة", false],
      ["الإكسسوارات", true],
      ["التحويلات", true],
    ]);

    const [created] = await auditOf(store.tenant.tenantId, "organization.department.archived");
    expect(created).toMatchObject({
      entity_id: repairs.id,
      before: { archivedAt: null },
      after: { archivedAt: clock.now().toISOString() },
    });
  });

  it("refuses a name another department has: trimmed, spaces collapsed, any case", async () => {
    const store = await newStore("متجر الأسماء", 5);
    const repairs = await addDepartment(store, "  قسم   الصيانة ");
    // Stored the way it is compared, so people see one spelling.
    expect(repairs.name).toBe("قسم الصيانة");
    expectProblem(
      await call(store, "POST", "/departments", { name: "قسم\tالصيانة" }),
      409,
      tenancyProblemCodes.departmentNameTaken,
    );
    expectProblem(
      await call(store, "PATCH", `/departments/${store.tenant.defaultDepartmentId}`, {
        name: " قسم الصيانة",
      }),
      409,
      tenancyProblemCodes.departmentNameTaken,
    );
    const phones = await addDepartment(store, "Phones");
    expectProblem(
      await call(store, "POST", "/departments", { name: "PHONES" }),
      409,
      tenancyProblemCodes.departmentNameTaken,
    );
    // Its own name in another case is a rename, not a clash.
    const recased = await call(store, "PATCH", `/departments/${phones.id}`, { name: "phones" });
    expect(recased.statusCode).toBe(200);

    // An archived department keeps its name: typing it is answered with that department's id,
    // so the screen can offer to restore it.
    await call(store, "POST", `/departments/${repairs.id}/archive`);
    for (const response of [
      await call(store, "POST", "/departments", { name: "قسم الصيانة" }),
      await call(store, "PATCH", `/departments/${phones.id}`, { name: "قسم  الصيانة" }),
    ]) {
      expectProblem(response, 409, tenancyProblemCodes.departmentNameArchived);
      expect(response.json()).toMatchObject({ detail: repairs.id });
    }
    // The database holds the rule too, whatever the application checks.
    await expect(
      superuser.query(
        `insert into core_tenancy.departments
           (id, tenant_id, branch_id, created_at, created_by, name, is_default, sort_order)
         select gen_random_uuid(), tenant_id, branch_id, now(), created_by, 'PHONES', false, 9
           from core_tenancy.departments where id = $1`,
        [phones.id],
      ),
    ).rejects.toThrow(/departments_name_per_tenant/);
  });

  it("restores an archived department within the license's limit, audited", async () => {
    const store = await newStore("متجر الاستعادة", 2);
    const repairs = await addDepartment(store, "الصيانة");
    await call(store, "POST", `/departments/${repairs.id}/archive`);
    const other = await addDepartment(store, "الإكسسوارات");
    // Two active of two: the archived one cannot come back until a place is free.
    expectProblem(
      await call(store, "POST", `/departments/${repairs.id}/restore`),
      409,
      tenancyProblemCodes.departmentLimit,
    );
    await call(store, "POST", `/departments/${other.id}/archive`);
    clock.advance(60_000);
    const restored = await call(store, "POST", `/departments/${repairs.id}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: repairs.id, name: "الصيانة", archivedAt: null });
    expectProblem(
      await call(store, "POST", `/departments/${repairs.id}/restore`),
      409,
      tenancyProblemCodes.departmentNotArchived,
    );
    expectProblem(
      await call(store, "POST", `/departments/${store.tenant.tenantId}/restore`),
      404,
      tenancyProblemCodes.departmentNotFound,
    );
    const [entry] = await auditOf(store.tenant.tenantId, "organization.department.restored");
    expect(entry).toMatchObject({
      entity_id: repairs.id,
      created_by: store.tenant.ownerId,
      before: { archivedAt: expect.any(String) as string },
      after: { archivedAt: null, usersInScope: [] },
    });
    // The panel's last line names the restore.
    const listed = (await departments(store)).find((d) => d.id === repairs.id);
    expect(listed?.lastChange).toMatchObject({
      at: clock.now().toISOString(),
      by: { id: store.tenant.ownerId, name: "أحمد" },
    });
  });

  it("gives a restored department back to the users whose scope listed it", async () => {
    const store = await newStore("متجر النطاق", 3);
    const repairs = await addDepartment(store, "الصيانة");
    const cashier = await createStaffUser(
      tenants,
      store.tenant,
      { login: "cashier", permissions: [], departments: [repairs.id] },
      dependencies,
    );
    await call(store, "POST", `/departments/${repairs.id}/archive`);
    const scopeOf = async () => {
      const users = await server.inject({
        method: "GET",
        url: "/api/v1/access/users",
        headers: { authorization: `Bearer ${store.token}` },
      });
      return users
        .json<{ items: { id: string; departments: string[] }[] }>()
        .items.find((user) => user.id === cashier.userId)?.departments;
    };
    expect(await scopeOf()).toEqual([]);
    expect((await call(store, "POST", `/departments/${repairs.id}/restore`)).statusCode).toBe(200);
    expect(await scopeOf()).toEqual([repairs.id]);
    const [entry] = await auditOf(store.tenant.tenantId, "organization.department.restored");
    expect(entry).toMatchObject({ after: { usersInScope: [cashier.userId] } });
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
    expectProblem(
      await call(mine, "POST", `/departments/${their.id}/restore`),
      404,
      tenancyProblemCodes.departmentNotFound,
    );
    // Names are unique per tenant: another store's department takes nothing from this one.
    expect((await addDepartment(mine, "الصيانة")).name).toBe("الصيانة");
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
      call(store, "POST", `/departments/${repairs.id}/restore`),
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

/** Registers a main POS device for `store` and returns its credential. */
async function registerDevice(store: Awaited<ReturnType<typeof newStore>>): Promise<string> {
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
  return registered.json<{ credential: string }>().credential;
}

describe("the store profile", () => {
  it("is edited as a whole, audited with before and after", async () => {
    const store = await newStore("متجر الملف");
    // A phone the slice 21 upgrade could not read, kept as typed until this save.
    await superuser.query(
      "update core_organization.store_profiles set unreadable_phones = $2 where tenant_id = $1",
      [store.tenant.tenantId, ["0944123456 0933123456"]],
    );
    expect(
      (await call(store, "GET", "/profile")).json<StoreProfileView>().unreadablePhones,
    ).toEqual(["0944123456 0933123456"]);
    const response = await call(store, "PUT", "/profile", {
      name: "متجر الملف الجديد",
      address: "دمشق، الحميدية",
      phones: ["+963 11 222 3333", "0944-123-456", "+961 3 123 456"],
      taxNumber: "123456",
      commercialRegister: "",
      logoPrint: "dither",
    });
    expect(response.statusCode).toBe(200);
    const profile = response.json<StoreProfileView>();
    // Phones are stored in E.164, a national number read as Syrian.
    expect(profile).toMatchObject({
      name: "متجر الملف الجديد",
      address: "دمشق، الحميدية",
      phones: ["+963112223333", "+963944123456", "+9613123456"],
      unreadablePhones: [],
      taxNumber: "123456",
      commercialRegister: null,
      logo: null,
      logoPrint: "dither",
    });
    const edits = await auditOf(store.tenant.tenantId, "organization.profile.changed");
    expect(edits).toHaveLength(1);
    expect(edits).toMatchObject([
      {
        entity_id: profile.id,
        before: {
          name: "متجر الملف",
          phones: [],
          unreadablePhones: ["0944123456 0933123456"],
          logoPrint: "threshold",
        },
        after: { name: "متجر الملف الجديد", taxNumber: "123456", logoPrint: "dither" },
      },
    ]);

    // A number that is not real is refused, as is an unknown print mode; the print mode left out
    // is the threshold.
    for (const body of [
      { name: "متجر", phones: ["1234"] },
      { name: "متجر", phones: ["0944 123"] },
      { name: "متجر", logoPrint: "halftone" },
    ]) {
      expectProblem(
        await call(store, "PUT", "/profile", body),
        400,
        hostProblemCodes.invalidRequest,
      );
    }
    expect(
      (await call(store, "PUT", "/profile", { name: "متجر" })).json<StoreProfileView>().logoPrint,
    ).toBe("threshold");

    expectProblem(
      await call(store, "PUT", "/profile", {
        name: "متجر",
        phones: ["0944123451", "0944123452", "0944123453", "0944123454"],
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

    // A registered device fetches it with its credential, to print it offline.
    const credential = await registerDevice(store);
    const onDevice = await server.inject({
      method: "GET",
      url: "/api/v1/organization/device/logo",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(onDevice.statusCode).toBe(200);
    expect(new Uint8Array(onDevice.rawPayload)).toEqual(largest);
    // A session is no device.
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/v1/organization/device/logo",
          headers: { authorization: `Bearer ${store.token}` },
        })
      ).statusCode,
    ).toBe(401);

    const removed = await call(store, "DELETE", "/profile/logo");
    expect(removed.json<StoreProfileView>().logo).toBeNull();
    expectProblem(
      await call(store, "GET", "/profile/logo"),
      404,
      organizationProblemCodes.logoNotFound,
    );
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/organization/device/logo",
        headers: { authorization: `Bearer ${credential}` },
      }),
      404,
      organizationProblemCodes.logoNotFound,
    );
  });

  it("gives a device only its own store's logo", async () => {
    const mine = await newStore("متجري");
    const other = await newStore("متجر آخر");
    await call(other, "PUT", "/profile/logo", { data: Buffer.from(PNG).toString("base64") });
    const credential = await registerDevice(mine);
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/organization/device/logo",
        headers: { authorization: `Bearer ${credential}` },
      }),
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

    const credential = await registerDevice(store);
    const pulled = await server.inject({
      method: "GET",
      url: "/api/v1/sync/pull?limit=1000",
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(pulled.statusCode).toBe(200);
    const { changes } = pulled.json<{
      changes: { entity: string; id: string; row: Record<string, unknown> | null }[];
    }>();

    // Each change carries the full row as the API shows it, archived departments included,
    // without the list's last change, which only the screen shows.
    const latest = new Map(changes.map((c) => [c.id, c]));
    const profile = (await call(store, "GET", "/profile")).json<StoreProfileView>();
    expect(
      [...latest.values()].filter((c) => c.entity === "organization.department").map((c) => c.row),
    ).toEqual(
      (await departments(store)).map((department) => {
        const { lastChange, ...row } = department;
        expect(lastChange).not.toBeUndefined();
        return row;
      }),
    );
    expect(latest.get(profile.id)).toEqual({
      entity: "organization.storeProfile",
      id: profile.id,
      row: profile,
    });
    expect(latest.get(repairs.id)?.row).toMatchObject({ name: "الصيانة", archivedAt: null });
  });
});
