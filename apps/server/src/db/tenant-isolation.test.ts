import {
  createOwner,
  hashPassword,
  issueRegistrationCode,
  openSession,
  registerDevice,
} from "@mustawfi/core-access/server";
import { recordAudit } from "@mustawfi/core-audit/server";
import { postJournalEntry, seedAccounts, systemAccounts } from "@mustawfi/core-ledger/server";
import {
  createTenant,
  openTenantDatabase,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { createProduct } from "@mustawfi/inventory/server";
import {
  cryptoRandom,
  Currency,
  Money,
  randomCode,
  systemClock,
  uuidV7Generator,
} from "@mustawfi/kernel";
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
const dependencies = { clock: systemClock, newId, random: cryptoRandom };

interface SeedTenant {
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
}

const seedFixtureItem = (tx: TenantTransaction, tenant: SeedTenant) =>
  tx.insert(items).values({
    id: newId(),
    tenantId: tenant.tenantId,
    branchId: tenant.branchId,
    createdAt: systemClock.now(),
    createdBy: tenant.userId,
    name: `item of ${tenant.tenantId}`,
  });

interface Seed {
  /** The tenant-owned tables this seed writes rows to. */
  readonly tables: readonly string[];
  readonly seed: (tx: TenantTransaction, tenant: SeedTenant) => Promise<unknown>;
}

/**
 * How to write rows of each tenant-owned table, through `withTenant` and the modules' own
 * functions as the application does, in dependency order. Every table the catalog finds needs
 * a seed: a new table without one fails "covers every tenant-owned table" below (ADR-0017
 * isolation test).
 */
const seeds: readonly Seed[] = [
  {
    tables: ["core_tenancy.tenants", "core_tenancy.branches"],
    seed: (tx, tenant) =>
      createTenant(tx, {
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        name: `tenant ${tenant.tenantId}`,
        baseCurrency: "SYP",
        storeCode: randomCode(cryptoRandom, 6),
        createdAt: systemClock.now(),
        createdBy: tenant.userId,
      }),
  },
  {
    tables: ["core_access.users"],
    seed: (tx, tenant) =>
      createOwner(tx, {
        id: tenant.userId,
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        name: "owner",
        login: "owner",
        passwordHash: ownerPasswordHash,
        createdAt: systemClock.now(),
        createdBy: tenant.userId,
      }),
  },
  {
    tables: ["core_access.sessions"],
    seed: (tx, tenant) => openSession(tx, { ...tenant, userId: tenant.userId }, dependencies),
  },
  {
    tables: ["core_access.registration_codes", "core_access.devices"],
    seed: async (tx, tenant) => {
      const { code } = await issueRegistrationCode(tx, tenant, dependencies);
      await registerDevice(
        tx,
        { tenantId: tenant.tenantId, registrationCode: code, type: "mainPos", name: "till" },
        dependencies,
      );
    },
  },
  {
    tables: ["core_audit.entries"],
    seed: (tx, tenant) =>
      recordAudit(tx, {
        id: newId(),
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        occurredAt: systemClock.now(),
        userId: tenant.userId,
        action: "fixture.isolation.seeded",
      }),
  },
  {
    tables: ["core_ledger.accounts", "core_ledger.journal_entries", "core_ledger.journal_lines"],
    seed: async (tx, tenant) => {
      const standard = {
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        createdAt: systemClock.now(),
        createdBy: tenant.userId,
      };
      await seedAccounts(tx, standard, newId);
      const { cash, salesRevenue } = await systemAccounts(tx);
      const amount = Money.of("1250.50", Currency.of("SYP", 2));
      const departmentId = newId();
      await postJournalEntry(
        tx,
        {
          id: newId(),
          tenantId: tenant.tenantId,
          branchId: tenant.branchId,
          accountingDate: "2026-09-25",
          postedAt: standard.createdAt,
          postedBy: tenant.userId,
          source: { type: "fixture.isolation", id: newId() },
          lines: [
            { accountId: cash.id, side: "debit", amount, departmentId },
            { accountId: salesRevenue.id, side: "credit", amount, departmentId },
          ],
        },
        dependencies,
      );
    },
  },
  {
    tables: ["inventory.products"],
    seed: (tx, tenant) =>
      createProduct(
        tx,
        {
          id: newId(),
          tenantId: tenant.tenantId,
          branchId: tenant.branchId,
          createdAt: systemClock.now(),
          createdBy: tenant.userId,
          name: "شاحن",
          barcode: "6291041500213",
          price: { amount: "12.5", currency: "USD" },
        },
        dependencies,
      ),
  },
  { tables: ["rls_fixture.items"], seed: seedFixtureItem },
];
const seededTables = seeds.flatMap((s) => s.tables).sort();

const tenantA: SeedTenant = { tenantId: newId(), branchId: newId(), userId: newId() };
const tenantB: SeedTenant = { tenantId: newId(), branchId: newId(), userId: newId() };
let ownerPasswordHash: string;

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

  ownerPasswordHash = await hashPassword("a long enough password");

  // A tenant has one row in `tenants`, so a leak shows up as a foreign row rather than in the
  // counts; the fixture table gets a second row for A, so there it shows up in both.
  for (const tenant of [tenantA, tenantB]) {
    await tenants.withTenant({ tenantId: tenant.tenantId, userId: tenant.userId }, async (tx) => {
      for (const { seed } of seeds) await seed(tx, tenant);
    });
  }
  await tenants.withTenant({ tenantId: tenantA.tenantId, userId: tenantA.userId }, (tx) =>
    seedFixtureItem(tx, tenantA),
  );
});

afterAll(async () => {
  await app.end();
  await superuser.end();
  await tenants.close();
});

describe("tenant isolation", () => {
  it("covers every tenant-owned table", async () => {
    const catalog = await inspectRlsCatalog(superuser);
    expect(catalog.tables).toEqual(seededTables);
  });

  it.each(seededTables)("keeps tenant B out of tenant A's reach in %s", (table) =>
    assertTenantIsolation({
      table,
      tenants: [tenantA.tenantId, tenantB.tenantId],
      runAs: (tenantId, fn) => tenants.withTenant({ tenantId }, (tx) => fn((q) => tx.execute(q))),
      superuser,
      app,
    }),
  );
});
