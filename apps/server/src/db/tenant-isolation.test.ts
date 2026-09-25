import {
  openTenantDatabase,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import {
  assertTenantIsolation,
  createTestDatabase,
  inspectRlsCatalog,
  type TestDatabase,
} from "@mustawfi/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate.ts";
import { migrationSets } from "./migration-sets.ts";
import { rlsFixtureMigrations } from "./test-fixtures/index.ts";
import { items } from "./test-fixtures/rls-fixture/schema.ts";

const newId = uuidV7Generator({ clock: systemClock, random: cryptoRandom });

interface SeedTenant {
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
}

/**
 * How to write one row of each tenant-owned table, through `withTenant` as the application
 * does. Every table the catalog finds needs an entry here: a new table without one fails
 * "covers every tenant-owned table" below (ADR-0017 isolation test).
 */
const seeds: Record<string, (tx: TenantTransaction, tenant: SeedTenant) => Promise<unknown>> = {
  "rls_fixture.items": (tx, tenant) =>
    tx.insert(items).values({
      id: newId(),
      tenantId: tenant.tenantId,
      branchId: tenant.branchId,
      createdAt: systemClock.now(),
      createdBy: tenant.userId,
      name: `item of ${tenant.tenantId}`,
    }),
};

const tenantA: SeedTenant = { tenantId: newId(), branchId: newId(), userId: newId() };
const tenantB: SeedTenant = { tenantId: newId(), branchId: newId(), userId: newId() };

let database: TestDatabase;
let tenants: TenantDatabase;
let superuser: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase("isolation");
  await applyMigrations(database.url("owner"), [...migrationSets, rlsFixtureMigrations]);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  app = await database.connect("app");

  // Two rows for A and one for B, so a leak shows up in the counts.
  for (const tenant of [tenantA, tenantA, tenantB]) {
    for (const seed of Object.values(seeds)) {
      await tenants.withTenant({ tenantId: tenant.tenantId, userId: tenant.userId }, (tx) =>
        seed(tx, tenant),
      );
    }
  }
});

afterAll(async () => {
  await app.end();
  await superuser.end();
  await tenants.close();
});

describe("tenant isolation", () => {
  it("covers every tenant-owned table", async () => {
    const catalog = await inspectRlsCatalog(superuser);
    expect(catalog.tables).toEqual(Object.keys(seeds).sort());
  });

  it.each(Object.keys(seeds))("keeps tenant B out of tenant A's reach in %s", (table) =>
    assertTenantIsolation({
      table,
      tenants: [tenantA.tenantId, tenantB.tenantId],
      runAs: (tenantId, fn) => tenants.withTenant({ tenantId }, (tx) => fn((q) => tx.execute(q))),
      superuser,
      app,
    }),
  );
});
