import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { type AuditEntry, recordAudit } from "@mustawfi/core-audit/server";
import {
  type AuditEntryView,
  type AuditFacets,
  type AuditPage,
  AUDIT_PAGE_DEFAULT,
} from "@mustawfi/core-audit/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry } from "./modules.ts";
import { createStaffUser, signInAs, STAFF_PASSWORD, type StaffUser } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * The audit log's read route (`core-foundation` slice 17, flow 10, rule 35):
 * `GET /api/v1/audit/entries` with its filters and keyset pages, and `GET /api/v1/audit/facets`,
 * readable by owners and holders of `audit.view` only, and only within the reader's tenant.
 */

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-26T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
}

beforeAll(async () => {
  database = await createTestDatabase("audit_log");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
});

afterAll(async () => {
  await server.close();
  await tenants.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function newStore(name: string): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
  );
  return { tenant, token: await signInAs(server, tenant, "ahmad", PASSWORD) };
}

/** A user who never signs in, so the log holds only the entries a test writes as them. */
function writerOf(store: Store, login: string): Promise<StaffUser> {
  return createStaffUser(
    tenants,
    store.tenant,
    { login, permissions: ["inventory.products.view"] },
    dependencies,
  );
}

async function staff(store: Store, login: string, permissions: readonly string[]) {
  const user = await createStaffUser(tenants, store.tenant, { login, permissions }, dependencies);
  return { user, token: await signInAs(server, store.tenant, login, STAFF_PASSWORD) };
}

async function registerDevice(
  store: Store,
  name: string,
): Promise<{ deviceId: string; prefix: string }> {
  const issued = await server.inject({
    method: "POST",
    url: "/api/v1/access/registration-codes",
    headers: bearer(store.token),
  });
  const registered = await server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: store.tenant.storeCode,
      registrationCode: issued.json<{ code: string }>().code,
      type: "mainPos",
      name,
    },
  });
  expect(registered.statusCode).toBe(201);
  return registered.json();
}

/** Writes an entry as a module would, in the store's tenant. */
async function record(
  store: Store,
  entry: Omit<AuditEntry, "id" | "tenantId" | "branchId">,
): Promise<string> {
  const id = newId();
  await tenants.withTenant({ tenantId: store.tenant.tenantId }, (tx) =>
    recordAudit(tx, {
      id,
      tenantId: store.tenant.tenantId,
      branchId: store.tenant.branchId,
      ...entry,
    }),
  );
  return id;
}

function entries(token: string, query: Record<string, string> = {}) {
  return server.inject({
    method: "GET",
    url: "/api/v1/audit/entries",
    query,
    headers: bearer(token),
  });
}

async function page(token: string, query: Record<string, string> = {}): Promise<AuditPage> {
  const response = await entries(token, query);
  expect(response.statusCode).toBe(200);
  return response.json<AuditPage>();
}

describe("who reads the audit log (rule 35)", () => {
  let store: Store;

  beforeAll(async () => {
    store = await newStore("متجر القراءة");
  });

  it("owners read it", async () => {
    const read = await page(store.token);
    // Creating the tenant audited it: the log is not empty.
    expect(read.items.map((entry) => entry.action)).toContain("tenancy.tenant.created");
  });

  it("holders of audit.view read it and its facets", async () => {
    const { token } = await staff(store, "accountant1", ["audit.view"]);
    expect((await entries(token)).statusCode).toBe(200);
    const facets = await server.inject({
      method: "GET",
      url: "/api/v1/audit/facets",
      headers: bearer(token),
    });
    expect(facets.statusCode).toBe(200);
  });

  it("anyone else gets 403 on the entries and the facets", async () => {
    const { token } = await staff(store, "cashier1", ["access.users.view", "sales.invoices.view"]);
    for (const url of ["/api/v1/audit/entries", "/api/v1/audit/facets"]) {
      const response = await server.inject({ method: "GET", url, headers: bearer(token) });
      expect(response.statusCode).toBe(403);
      expect(problemDetailsSchema.parse(response.json()).code).toBe(
        accessProblemCodes.permissionDenied,
      );
    }
  });

  it("no session gets 401", async () => {
    const response = await server.inject({ method: "GET", url: "/api/v1/audit/entries" });
    expect(response.statusCode).toBe(401);
  });

  it("no route changes or removes an entry", async () => {
    const { items } = await page(store.token, { limit: "1" });
    const id = items[0]?.id ?? "";
    for (const method of ["PUT", "PATCH", "DELETE", "POST"] as const) {
      const response = await server.inject({
        method,
        url: `/api/v1/audit/entries/${id}`,
        headers: bearer(store.token),
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe("filters", () => {
  let store: Store;
  let writer: StaffUser;
  let till: { deviceId: string; prefix: string };

  beforeAll(async () => {
    store = await newStore("متجر التصفية");
    writer = await writerOf(store, "writer");
    till = await registerDevice(store, "الصندوق الأول");
    // Around the start of 2026-09-25 in Damascus (UTC+3): 2026-09-24T21:00Z.
    await record(store, {
      occurredAt: new Date("2026-09-24T20:59:59.999Z"),
      userId: writer.userId,
      action: "organization.department.renamed",
      before: { name: "قديم" },
      after: { name: "جديد" },
    });
    await record(store, {
      occurredAt: new Date("2026-09-24T21:00:00.000Z"),
      userId: writer.userId,
      deviceId: till.deviceId,
      action: "access.pin.failed",
      receivedAt: new Date("2026-09-25T06:00:00.000Z"),
    });
    await record(store, {
      occurredAt: new Date("2026-09-25T20:59:59.999Z"),
      userId: writer.userId,
      action: "access.user.deactivated",
      entity: { type: "access.user", id: writer.userId },
      reason: "ترك العمل",
    });
    await record(store, {
      occurredAt: new Date("2026-09-25T21:00:00.000Z"),
      userId: writer.userId,
      action: "organization.department.renamed",
    });
  });

  const times = (items: readonly AuditEntryView[]) => items.map((entry) => entry.occurredAt);

  it("by user, newest first, with the user's name", async () => {
    const { items, next } = await page(store.token, { user: writer.userId });
    expect(times(items)).toEqual([
      "2026-09-25T21:00:00.000Z",
      "2026-09-25T20:59:59.999Z",
      "2026-09-24T21:00:00.000Z",
      "2026-09-24T20:59:59.999Z",
    ]);
    expect(next).toBeNull();
    expect(items.every((entry) => entry.user?.name === "writer")).toBe(true);
  });

  it("by action", async () => {
    const { items } = await page(store.token, {
      user: writer.userId,
      action: "organization.department.renamed",
    });
    expect(times(items)).toEqual(["2026-09-25T21:00:00.000Z", "2026-09-24T20:59:59.999Z"]);
    expect(items[1]).toMatchObject({ before: { name: "قديم" }, after: { name: "جديد" } });
  });

  it("by device, with its name and prefix, the device's time and the server's", async () => {
    const { items } = await page(store.token, { device: till.deviceId });
    // Its registration, audited by the server with the device, and the event it sent.
    expect(items.map((entry) => entry.action)).toEqual([
      "access.device.registered",
      "access.pin.failed",
    ]);
    expect(items.every((entry) => entry.device?.id === till.deviceId)).toBe(true);
    expect(items[1]).toMatchObject({
      source: "device",
      action: "access.pin.failed",
      occurredAt: "2026-09-24T21:00:00.000Z",
      recordedAt: "2026-09-25T06:00:00.000Z",
      device: { id: till.deviceId, name: "الصندوق الأول", prefix: till.prefix },
    });
  });

  it("by a date range of business days in Damascus, both ends included", async () => {
    const oneDay = await page(store.token, {
      user: writer.userId,
      from: "2026-09-25",
      to: "2026-09-25",
    });
    expect(times(oneDay.items)).toEqual(["2026-09-25T20:59:59.999Z", "2026-09-24T21:00:00.000Z"]);
    expect(oneDay.items[0]).toMatchObject({
      reason: "ترك العمل",
      entity: { type: "access.user", id: writer.userId },
    });
    const fromOnly = await page(store.token, { user: writer.userId, from: "2026-09-26" });
    expect(times(fromOnly.items)).toEqual(["2026-09-25T21:00:00.000Z"]);
    const toOnly = await page(store.token, { user: writer.userId, to: "2026-09-24" });
    expect(times(toOnly.items)).toEqual(["2026-09-24T20:59:59.999Z"]);
  });

  it("refuses a range that ends before it starts, and a malformed filter", async () => {
    for (const query of [
      { from: "2026-09-26", to: "2026-09-25" },
      { user: "someone" },
      { action: "Not An Action" },
      { limit: "101" },
    ]) {
      expect((await entries(store.token, query)).statusCode).toBe(400);
    }
  });

  it("facets list the store's users and devices and the actions its log holds", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/audit/facets",
      headers: bearer(store.token),
    });
    const facets = response.json<AuditFacets>();
    expect(facets.users.map((user) => user.name)).toEqual(
      expect.arrayContaining(["أحمد", "writer"]),
    );
    expect(facets.devices).toEqual([
      { id: till.deviceId, name: "الصندوق الأول", prefix: till.prefix },
    ]);
    expect(facets.actions).toEqual(
      expect.arrayContaining([
        "access.pin.failed",
        "access.user.deactivated",
        "organization.department.renamed",
        "tenancy.tenant.created",
      ]),
    );
    expect(new Set(facets.actions).size).toBe(facets.actions.length);
  });
});

describe("keyset pages", () => {
  let store: Store;
  let writer: StaffUser;

  beforeAll(async () => {
    store = await newStore("متجر الصفحات");
    writer = await writerOf(store, "pager");
    // Seven entries, two of them at the same instant (the id breaks the tie).
    const base = Date.parse("2026-09-20T10:00:00.000Z");
    for (const minutes of [0, 1, 2, 2, 3, 4, 5]) {
      await record(store, {
        occurredAt: new Date(base + minutes * 60_000),
        userId: writer.userId,
        action: "organization.department.renamed",
      });
    }
  });

  async function walk(limit: string, between?: () => Promise<void>): Promise<string[]> {
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const query: Record<string, string> = { user: writer.userId, limit };
      if (after !== null) query.after = after;
      const next: AuditPage = await page(store.token, query);
      seen.push(...next.items.map((entry) => entry.id));
      after = next.next;
      await between?.();
    } while (after !== null);
    return seen;
  }

  it("walks every entry once, newest first", async () => {
    const all = (await page(store.token, { user: writer.userId })).items.map((entry) => entry.id);
    expect(all).toHaveLength(7);
    expect(await walk("2")).toEqual(all);
    expect(await walk("3")).toEqual(all);
    expect(await walk("7")).toEqual(all);
  });

  it("a newer entry recorded between pages does not shift or repeat a page", async () => {
    const before = (await page(store.token, { user: writer.userId })).items.map(
      (entry) => entry.id,
    );
    let minutes = 60;
    const seen = await walk("2", async () => {
      minutes += 1;
      await record(store, {
        occurredAt: new Date(Date.parse("2026-09-20T10:00:00.000Z") + minutes * 60_000),
        userId: writer.userId,
        action: "organization.department.renamed",
      });
    });
    expect(seen).toEqual(before);
  });

  it("pages hold the default number when none is asked", async () => {
    expect(AUDIT_PAGE_DEFAULT).toBe(50);
    const { items } = await page(store.token);
    expect(items.length).toBeLessThanOrEqual(AUDIT_PAGE_DEFAULT);
  });
});

describe("tenant isolation", () => {
  it("a store reads only its own log, and another store's entry as `after` gives nothing", async () => {
    const a = await newStore("متجر أ");
    const b = await newStore("متجر ب");
    const secret = await record(a, {
      occurredAt: clock.now(),
      userId: a.tenant.ownerId,
      action: "organization.department.renamed",
    });
    const fromB = await page(b.token, { limit: "100" });
    expect(fromB.items.map((entry) => entry.id)).not.toContain(secret);
    expect(
      fromB.items.every((entry) => entry.user === null || entry.user.id === b.tenant.ownerId),
    ).toBe(true);
    expect((await page(b.token, { after: secret })).items).toEqual([]);
    const facets = await server.inject({
      method: "GET",
      url: "/api/v1/audit/facets",
      headers: bearer(b.token),
    });
    expect(facets.json<AuditFacets>().users.map((user) => user.id)).toEqual([b.tenant.ownerId]);
  });
});
