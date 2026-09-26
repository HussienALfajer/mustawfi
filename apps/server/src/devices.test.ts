import { accessProblemCodes, type DeviceView } from "@mustawfi/core-access/shared";
import { DEVICE_CREDENTIAL_HEADER, problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { PushResponse, SyncOperation } from "@mustawfi/core-sync/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { ProductView } from "@mustawfi/inventory/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry } from "./modules.ts";
import { invoiceOperation } from "./sales-operations.test-helpers.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * Device revoke (`core-foundation` slice 9, rule 23, ADR-0030): the devices list, revoke with a
 * reason, the revoked credential refused everywhere but push, pushed operations accepted and
 * flagged `deviceRevoked`, the wipe report, and the device limit that a revoke frees.
 */

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-26T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
  readonly product: ProductView;
}

interface TestDevice {
  readonly deviceId: string;
  readonly prefix: string;
  readonly credential: string;
  seq: number;
}

beforeAll(async () => {
  database = await createTestDatabase("devices");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

async function newStore(name: string, mainPosDevices = 20): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
    { limits: { mainPosDevices } },
  );
  const token = await signInAs(server, tenant, "ahmad", PASSWORD);
  const product = await server.inject({
    method: "POST",
    url: "/api/v1/inventory/products",
    headers: bearer(token),
    payload: { name: "شاحن", price: { amount: "100", currency: "SYP" } },
  });
  expect(product.statusCode).toBe(201);
  return { tenant, token, product: product.json<ProductView>() };
}

function register(store: Store, name = "الصندوق") {
  return server
    .inject({
      method: "POST",
      url: "/api/v1/access/registration-codes",
      headers: bearer(store.token),
    })
    .then((issued) =>
      server.inject({
        method: "POST",
        url: "/api/v1/access/devices",
        payload: {
          storeCode: store.tenant.storeCode,
          registrationCode: issued.json<{ code: string }>().code,
          type: "mainPos",
          name,
        },
      }),
    );
}

async function newDevice(store: Store, name?: string): Promise<TestDevice> {
  const registered = await register(store, name);
  expect(registered.statusCode).toBe(201);
  return { ...registered.json<Omit<TestDevice, "seq">>(), seq: 1 };
}

function sale(store: Store, device: TestDevice, payload?: Record<string, unknown>): SyncOperation {
  const seq = device.seq;
  device.seq += 1;
  return invoiceOperation({
    newId,
    device,
    userId: store.tenant.ownerId,
    departmentId: store.tenant.defaultDepartmentId,
    deviceSeq: seq,
    lines: [{ productId: store.product.id, quantity: "1", unitPrice: "100" }],
    ...(payload === undefined ? {} : { payload }),
  });
}

function push(device: TestDevice, operations: readonly SyncOperation[]) {
  return server.inject({
    method: "POST",
    url: "/api/v1/sync/push",
    headers: bearer(device.credential),
    payload: { operations },
  });
}

function pull(device: TestDevice) {
  return server.inject({
    method: "GET",
    url: "/api/v1/sync/pull",
    headers: bearer(device.credential),
  });
}

function revoke(store: Store, deviceId: string, reason: unknown = "سُرق الجهاز", token?: string) {
  return server.inject({
    method: "POST",
    url: `/api/v1/access/devices/${deviceId}/revoke`,
    headers: bearer(token ?? store.token),
    payload: { reason },
  });
}

async function listDevices(store: Store): Promise<DeviceView[]> {
  const response = await server.inject({
    method: "GET",
    url: "/api/v1/access/devices",
    headers: bearer(store.token),
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ items: DeviceView[] }>().items;
}

async function flagsOf(tenantId: string, opIds: readonly string[]) {
  const { rows } = await superuser.query<{ op_id: string; code: string; detail: unknown }>(
    "select op_id, code, detail from core_sync.operation_flags where tenant_id = $1 and op_id = any($2::uuid[]) order by created_at",
    [tenantId, opIds],
  );
  return rows;
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    device_id: string | null;
    entity_id: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
  }>(
    `select created_by, device_id, entity_id, before, after, reason from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

describe("the devices list (flow 9)", () => {
  it("lists every device with its type, prefix, registration, last sync, and status", async () => {
    const store = await newStore("متجر القائمة");
    const till = await newDevice(store, "الصندوق");
    const registeredAt = clock.now().toISOString();
    expect(await listDevices(store)).toEqual([
      {
        id: till.deviceId,
        name: "الصندوق",
        type: "mainPos",
        prefix: till.prefix,
        registeredAt,
        lastSyncAt: null,
        status: "active",
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
        wipedAt: null,
      },
    ]);

    // Each pull and push records the server's time.
    clock.advance(60_000);
    expect((await pull(till)).statusCode).toBe(200);
    expect((await listDevices(store))[0]?.lastSyncAt).toBe(clock.now().toISOString());
    clock.advance(60_000);
    expect((await push(till, [sale(store, till)])).statusCode).toBe(200);
    expect((await listDevices(store))[0]?.lastSyncAt).toBe(clock.now().toISOString());
  });

  it("needs access.devices.manage to list or revoke", async () => {
    const store = await newStore("متجر الصلاحية");
    const till = await newDevice(store);
    await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer", permissions: ["access.users.view"] },
      dependencies,
    );
    const viewer = await signInAs(server, store.tenant, "viewer");
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/access/devices",
        headers: bearer(viewer),
      }),
      403,
      accessProblemCodes.permissionDenied,
    );
    expectProblem(
      await revoke(store, till.deviceId, "سبب", viewer),
      403,
      accessProblemCodes.permissionDenied,
    );
  });
});

describe("revoking a device (rule 23)", () => {
  it("revokes with a reason, ends its sessions, audits it, and refuses its credential but for push", async () => {
    const store = await newStore("متجر الإبطال");
    const till = await newDevice(store);
    // A session opened on the till is bound to it (rule 22).
    const bound = await server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      headers: { [DEVICE_CREDENTIAL_HEADER]: till.credential },
      payload: { storeCode: store.tenant.storeCode, login: "ahmad", password: PASSWORD },
    });
    expect(bound.statusCode).toBe(200);
    const boundToken = bound.json<{ token: string }>().token;
    const onTill = { ...bearer(boundToken), [DEVICE_CREDENTIAL_HEADER]: till.credential };

    clock.advance(60_000);
    const revokedAt = clock.now().toISOString();
    const response = await revoke(store, till.deviceId, "  سُرق الجهاز  ");
    expect(response.statusCode).toBe(200);
    expect(response.json<DeviceView>()).toMatchObject({
      id: till.deviceId,
      status: "revoked",
      revokedAt,
      revokedBy: { id: store.tenant.ownerId, name: "أحمد" },
      revokeReason: "سُرق الجهاز",
      wipedAt: null,
    });
    expect(await auditOf(store.tenant.tenantId, "access.device.revoked")).toEqual([
      {
        created_by: store.tenant.ownerId,
        device_id: null,
        entity_id: till.deviceId,
        before: { status: "active" },
        after: { status: "revoked", sessionsRevoked: 1 },
        reason: "سُرق الجهاز",
      },
    ]);

    // Its session ended with it; the owner's own session in the browser did not.
    expectProblem(
      await server.inject({ method: "GET", url: "/api/v1/access/session", headers: onTill }),
      401,
      accessProblemCodes.sessionRequired,
    );
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/v1/access/session",
          headers: bearer(store.token),
        })
      ).statusCode,
    ).toBe(200);

    // Its credential: refused for pull, its own view, and sign-in on it; push stays open.
    expectProblem(await pull(till), 401, accessProblemCodes.deviceRevoked);
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/access/devices/current",
        headers: bearer(till.credential),
      }),
      401,
      accessProblemCodes.deviceRevoked,
    );
    expectProblem(
      await server.inject({
        method: "POST",
        url: "/api/v1/access/login",
        headers: { [DEVICE_CREDENTIAL_HEADER]: till.credential },
        payload: { storeCode: store.tenant.storeCode, login: "ahmad", password: PASSWORD },
      }),
      401,
      accessProblemCodes.deviceRevoked,
    );
    expectProblem(
      await server.inject({
        method: "POST",
        url: "/api/v1/access/pin-login",
        headers: { [DEVICE_CREDENTIAL_HEADER]: till.credential },
        payload: { userId: store.tenant.ownerId, pin: "2580", transport: "bearer" },
      }),
      401,
      accessProblemCodes.deviceRevoked,
    );
    expect((await push(till, [sale(store, till)])).statusCode).toBe(200);
  });

  it("refuses a session bound to a revoked device even if its revoke missed that session", async () => {
    const store = await newStore("متجر الجلسة");
    const till = await newDevice(store);
    const bound = await server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      headers: { [DEVICE_CREDENTIAL_HEADER]: till.credential },
      payload: { storeCode: store.tenant.storeCode, login: "ahmad", password: PASSWORD },
    });
    const onTill = {
      ...bearer(bound.json<{ token: string }>().token),
      [DEVICE_CREDENTIAL_HEADER]: till.credential,
    };
    // As if a session opened while the revoke committed: the device is revoked, the session not.
    await superuser.query(
      "update core_access.devices set revoked_at = now(), revoked_by = $2, revoke_reason = 'سبب' where id = $1",
      [till.deviceId, store.tenant.ownerId],
    );
    expectProblem(
      await server.inject({ method: "GET", url: "/api/v1/access/session", headers: onTill }),
      401,
      accessProblemCodes.sessionRequired,
    );
  });

  it("refuses a second revoke, an unknown device, another store's device, and no reason", async () => {
    const store = await newStore("متجر الرفض");
    const other = await newStore("متجر آخر");
    const till = await newDevice(store);
    const elsewhere = await newDevice(other);
    expect((await revoke(store, till.deviceId)).statusCode).toBe(200);
    expectProblem(await revoke(store, till.deviceId), 409, accessProblemCodes.deviceAlreadyRevoked);
    expectProblem(await revoke(store, newId()), 404, accessProblemCodes.deviceNotFound);
    expectProblem(await revoke(store, elsewhere.deviceId), 404, accessProblemCodes.deviceNotFound);
    expect((await revoke(store, till.deviceId, "   ")).statusCode).toBe(400);
    expect((await listDevices(other))[0]?.status).toBe("active");
    expect(await auditOf(store.tenant.tenantId, "access.device.revoked")).toHaveLength(1);
  });

  it("accepts everything the revoked device pushes, flags it deviceRevoked, and says revoked", async () => {
    const store = await newStore("متجر المبيعات");
    const till = await newDevice(store);
    const before = sale(store, till);
    const pushed = await push(till, [before]);
    expect(pushed.json<PushResponse>()).toMatchObject({ revoked: false, gap: false });

    // Offline, it sold twice more, and made one malformed operation, before it heard.
    const offline = [sale(store, till), sale(store, till), sale(store, till, { total: "oops" })];
    clock.advance(60_000);
    const revokedAt = clock.now().toISOString();
    expect((await revoke(store, till.deviceId)).statusCode).toBe(200);
    clock.advance(60_000);

    const first = await push(till, [before, ...offline]);
    expect(first.statusCode).toBe(200);
    const answer = first.json<PushResponse>();
    expect(answer.revoked).toBe(true);
    expect(answer.results.map((result) => result.status)).toEqual([
      "duplicate",
      "accepted",
      "accepted",
      "rejected",
    ]);
    // What arrived after the revoke is flagged; what arrived before is not; a rejection has none.
    expect(
      await flagsOf(
        store.tenant.tenantId,
        [before, ...offline].map((op) => op.opId),
      ),
    ).toEqual(
      offline.slice(0, 2).map((op) => ({
        op_id: op.opId,
        code: "deviceRevoked",
        detail: { revokedAt },
      })),
    );
    const { rows } = await superuser.query<{ id: string }>(
      "select id from sales.invoices where tenant_id = $1 and device_id = $2",
      [store.tenant.tenantId, till.deviceId],
    );
    expect(rows).toHaveLength(3);

    // A resend answers the same, flags nothing twice.
    const again = await push(till, offline.slice(0, 2));
    expect(again.json<PushResponse>()).toMatchObject({ revoked: true });
    expect(
      await flagsOf(
        store.tenant.tenantId,
        offline.map((op) => op.opId),
      ),
    ).toHaveLength(2);
  });

  it("frees its place in the license's device limit, and its prefix is never reused", async () => {
    const store = await newStore("متجر الحد", 1);
    const first = await newDevice(store);
    expectProblem(await register(store), 409, "tenancy.limit.mainPosDevices");
    expect((await revoke(store, first.deviceId)).statusCode).toBe(200);
    const second = await newDevice(store);
    expect(second.prefix).not.toBe(first.prefix);
    expect((await listDevices(store)).map((device) => device.status)).toEqual([
      "revoked",
      "active",
    ]);
  });
});

describe("the wipe report", () => {
  it("is refused from a device that is not revoked", async () => {
    const store = await newStore("متجر نشط");
    const till = await newDevice(store);
    expectProblem(
      await server.inject({
        method: "POST",
        url: "/api/v1/access/devices/current/wipe",
        headers: bearer(till.credential),
      }),
      409,
      accessProblemCodes.deviceNotRevoked,
    );
  });

  it("records the revoked device's wipe once, audited as the device", async () => {
    const store = await newStore("متجر المسح");
    const till = await newDevice(store);
    expect((await revoke(store, till.deviceId)).statusCode).toBe(200);
    clock.advance(60_000);
    const wipedAt = clock.now().toISOString();
    const report = () =>
      server.inject({
        method: "POST",
        url: "/api/v1/access/devices/current/wipe",
        headers: bearer(till.credential),
      });
    expect((await report()).statusCode).toBe(204);
    clock.advance(60_000);
    expect((await report()).statusCode).toBe(204);
    expect((await listDevices(store))[0]?.wipedAt).toBe(wipedAt);
    expect(await auditOf(store.tenant.tenantId, "access.device.wiped")).toEqual([
      {
        created_by: null,
        device_id: till.deviceId,
        entity_id: till.deviceId,
        before: null,
        after: null,
        reason: null,
      },
    ]);
  });
});

describe("the devices table", () => {
  it("keeps a revoke final and complete, whatever the application sends", async () => {
    const store = await newStore("متجر القيود");
    const till = await newDevice(store);
    const active = await newDevice(store, "الثاني");
    expect((await revoke(store, till.deviceId)).statusCode).toBe(200);
    const app = await database.connect("app");
    try {
      await app.query("select set_config('app.tenant_id', $1, false)", [store.tenant.tenantId]);
      const refused = async (statement: string, params: unknown[], state: string) => {
        await expect(app.query(statement, params)).rejects.toSatisfy(
          (error: unknown) => sqlState(error) === state,
        );
      };
      // Undoing or rewriting a revoke, or recording a wipe twice.
      await refused(
        "update core_access.devices set revoked_at = null, revoked_by = null, revoke_reason = null where id = $1",
        [till.deviceId],
        "23514",
      );
      await refused(
        "update core_access.devices set revoke_reason = 'غير ذلك' where id = $1",
        [till.deviceId],
        "23514",
      );
      await app.query("update core_access.devices set wiped_at = now() where id = $1", [
        till.deviceId,
      ]);
      await refused(
        "update core_access.devices set wiped_at = now() + interval '1 day' where id = $1",
        [till.deviceId],
        "23514",
      );
      // A revoke without who or why, or a wipe without a revoke.
      await refused(
        "update core_access.devices set revoked_at = now() where id = $1",
        [active.deviceId],
        "23514",
      );
      await refused(
        "update core_access.devices set wiped_at = now() where id = $1",
        [active.deviceId],
        "23514",
      );
      // Nothing else of a device changes, and no device is deleted.
      await refused(
        "update core_access.devices set prefix = 'ZZ' where id = $1",
        [active.deviceId],
        "42501",
      );
      await refused("delete from core_access.devices where id = $1", [active.deviceId], "42501");
    } finally {
      await app.end();
    }
  });
});
