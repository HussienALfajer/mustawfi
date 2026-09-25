import { sql } from "drizzle-orm";
import { boolean, check, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * `core_tenancy` tables (ADR-0016). Internal to the module: no entry exports them.
 *
 * A tenant and its branches are tenant-owned rows like any other, so the RLS catalog and
 * isolation tests cover them: a tenant's `tenant_id` is its own `id`, and a branch's
 * `branch_id` is its own `id`.
 */
export const coreTenancy = pgSchema("core_tenancy");

export const tenants = coreTenancy.table(
  "tenants",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull().unique(),
    /** The hidden default branch (V1 has exactly one); deferred FK in `0001_tenancy_rls.sql`. */
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    /** ISO 4217 code of the ledger's base currency; `core.currency` owns currency data. */
    baseCurrency: text().notNull(),
  },
  (t) => [
    check("tenants_tenant_id_is_id", sql`${t.tenantId} = ${t.id}`),
    check("tenants_base_currency_code", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

export const branches = coreTenancy.table(
  "branches",
  {
    id: uuid().primaryKey(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    /** The branch every V1 document belongs to; the UI hides it until multi-branch. */
    isDefault: boolean().notNull(),
  },
  (t) => [
    check("branches_branch_id_is_id", sql`${t.branchId} = ${t.id}`),
    uniqueIndex("branches_one_default_per_tenant")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ],
);
