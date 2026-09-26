import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { hostProblemCodes, problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { inventoryProblemCodes, type ProductView } from "@mustawfi/inventory/shared";
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
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-25T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;
let store: CreatedTenant;
let other: CreatedTenant;
let token: string;
let otherToken: string;

async function signIn(tenant: CreatedTenant): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

beforeAll(async () => {
  database = await createTestDatabase("inventory");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  const registry = createServerRegistry();
  server = await buildHostServer({
    registry,
    services: {
      tenants,
      clock,
      newId,
      random: cryptoRandom,
      totpKeys: testTotpKeys,
    },
  });
  const input = {
    baseCurrency: "SYP",
    ownerName: "أحمد",
    ownerLogin: "ahmad",
    ownerPassword: PASSWORD,
  };
  store = await createLicensedTenant(tenants, { ...input, name: "متجر النور" }, dependencies);
  other = await createLicensedTenant(tenants, { ...input, name: "متجر آخر" }, dependencies);
  token = await signIn(store);
  otherToken = await signIn(other);
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

const headers = (bearer: string = token) => ({ authorization: `Bearer ${bearer}` });

function create(payload: unknown, bearer: string | null = token) {
  return server.inject({
    method: "POST",
    url: "/api/v1/inventory/products",
    payload: payload as Record<string, unknown>,
    ...(bearer === null ? {} : { headers: headers(bearer) }),
  });
}

function list(query = "", bearer: string | null = token) {
  return server.inject({
    method: "GET",
    url: `/api/v1/inventory/products${query}`,
    ...(bearer === null ? {} : { headers: headers(bearer) }),
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

describe("POST /api/v1/inventory/products", () => {
  it("creates a product priced in its own currency, stored exactly and audited", async () => {
    const response = await create({
      name: "  شاحن سامسونج 25 واط ",
      barcode: "8806090000001",
      price: { amount: "12.50", currency: "USD" },
    });
    expect(response.statusCode).toBe(201);
    const product = response.json<ProductView>();
    expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(product).toEqual({
      id: product.id,
      name: "شاحن سامسونج 25 واط",
      barcode: "8806090000001",
      price: { amount: "12.5", currency: "USD" },
      createdAt: clock.now().toISOString(),
    });

    const row = await superuser.query(
      "select tenant_id, branch_id, created_by, price, price_currency from inventory.products where id = $1",
      [product.id],
    );
    expect(row.rows).toEqual([
      {
        tenant_id: store.tenantId,
        branch_id: store.branchId,
        created_by: store.ownerId,
        price: "12.500000",
        price_currency: "USD",
      },
    ]);
    const audit = await superuser.query(
      "select created_by, entity_id, after from core_audit.entries where action = 'inventory.product.created' and entity_id = $1",
      [product.id],
    );
    expect(audit.rows).toEqual([
      {
        created_by: store.ownerId,
        entity_id: product.id,
        after: {
          name: "شاحن سامسونج 25 واط",
          barcode: "8806090000001",
          price: { amount: "12.5", currency: "USD" },
        },
      },
    ]);
  });

  it("keeps a unit price's six decimals and accepts a product without a barcode", async () => {
    const response = await create({
      name: "كرت شحن",
      price: { amount: "0.123456", currency: "SYP" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<ProductView>()).toMatchObject({
      barcode: null,
      price: { amount: "0.123456", currency: "SYP" },
    });
  });

  it("refuses a barcode another of the tenant's products has, but not another tenant's", async () => {
    const product = {
      name: "سماعة",
      barcode: "6291041500213",
      price: { amount: "5", currency: "USD" },
    };
    expect((await create(product)).statusCode).toBe(201);
    expectProblem(await create(product), 409, inventoryProblemCodes.barcodeTaken);
    expect((await create(product, otherToken)).statusCode).toBe(201);
  });

  it.each([
    ["a price as a JSON number", { name: "x", price: { amount: 12.5, currency: "USD" } }],
    ["a price with seven decimals", { name: "x", price: { amount: "1.0000001", currency: "USD" } }],
    ["a negative price", { name: "x", price: { amount: "-1", currency: "USD" } }],
    ["a price in exponent form", { name: "x", price: { amount: "1e3", currency: "USD" } }],
    [
      "a price too large for its column",
      { name: "x", price: { amount: "100000000000000", currency: "USD" } },
    ],
    ["a lower-case currency", { name: "x", price: { amount: "1", currency: "usd" } }],
    ["an empty name", { name: "   ", price: { amount: "1", currency: "USD" } }],
    [
      "a barcode with a space",
      { name: "x", barcode: "12 34", price: { amount: "1", currency: "USD" } },
    ],
  ])("refuses %s", async (_, payload) => {
    expectProblem(await create(payload), 400, hostProblemCodes.invalidRequest);
  });

  it("needs a session", async () => {
    const payload = { name: "x", price: { amount: "1", currency: "USD" } };
    expectProblem(await create(payload, null), 401, accessProblemCodes.sessionRequired);
    expectProblem(await create(payload, "s1.nonsense"), 401, accessProblemCodes.sessionRequired);
  });
});

describe("GET /api/v1/inventory/products", () => {
  it("lists only the session's tenant's products, in pages", async () => {
    const theirs = await create(
      { name: "منتج الآخر", price: { amount: "1", currency: "SYP" } },
      otherToken,
    );
    expect(theirs.statusCode).toBe(201);
    const theirId = theirs.json<ProductView>().id;

    const all = await list();
    expect(all.statusCode).toBe(200);
    const { items, next } = all.json<{ items: ProductView[]; next: string | null }>();
    expect(next).toBeNull();
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.map((p) => p.id)).not.toContain(theirId);
    const { rows } = await superuser.query<{ id: string }>(
      "select id from inventory.products where tenant_id = $1 order by id",
      [store.tenantId],
    );
    expect(items.map((p) => p.id)).toEqual(rows.map((r) => r.id));

    const first = (await list("?limit=2")).json<{ items: ProductView[]; next: string | null }>();
    expect(first.items.map((p) => p.id)).toEqual(rows.slice(0, 2).map((r) => r.id));
    expect(first.next).toBe(rows[1]?.id);
    const rest = (await list(`?after=${first.next ?? ""}&limit=500`)).json<{
      items: ProductView[];
      next: string | null;
    }>();
    expect(rest.items.map((p) => p.id)).toEqual(rows.slice(2).map((r) => r.id));
    expect(rest.next).toBeNull();
  });

  it("refuses a malformed page and needs a session", async () => {
    expectProblem(await list("?limit=0"), 400, hostProblemCodes.invalidRequest);
    expectProblem(await list("?after=not-a-uuid"), 400, hostProblemCodes.invalidRequest);
    expectProblem(await list("", null), 401, accessProblemCodes.sessionRequired);
  });
});
