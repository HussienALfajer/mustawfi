import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    /**
     * What people type to name their store at sign-in (ADR-0029); unique across tenants,
     * never changed or reused. Published to `store_codes` by a trigger.
     */
    storeCode: text().notNull().unique(),
  },
  (t) => [
    check("tenants_tenant_id_is_id", sql`${t.tenantId} = ${t.id}`),
    check("tenants_base_currency_code", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
    check("tenants_store_code_format", sql`${t.storeCode} ~ '^[A-HJ-NP-Z2-9]{6}$'`),
  ],
);

/**
 * The store-code directory (ADR-0029): the one table that maps a code to its tenant before
 * any tenant context exists. Not tenant-owned and without row-level security, so it is
 * sealed instead: `mustawfi_app` holds no privilege on it and reaches it only through
 * `core_tenancy.tenant_for_store_code(code)`, which answers one exact code.
 */
export const storeCodes = coreTenancy.table("store_codes", {
  code: text().primaryKey(),
  tenantId: uuid()
    .notNull()
    .unique()
    .references(() => tenants.id),
});

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

/**
 * Departments (profit centers, ADR-0030): stored here, next to branches, so user scopes,
 * journal lines, and documents can reference them; `core.organization` manages them. Archived,
 * never deleted: `mustawfi_app` has no `DELETE`. One default per tenant, created with it, which
 * is never archived.
 */
export const departments = coreTenancy.table(
  "departments",
  {
    id: uuid().primaryKey(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    isDefault: boolean().notNull(),
    sortOrder: integer().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    archivedBy: uuid(),
  },
  (t) => [
    uniqueIndex("departments_one_default_per_tenant")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
    uniqueIndex("departments_active_name_per_tenant")
      .on(t.tenantId, t.name)
      .where(sql`${t.archivedAt} is null`),
    // Target of tenant-scoped foreign keys (user scopes, journal lines, documents).
    unique("departments_id_per_tenant").on(t.tenantId, t.id),
    check(
      "departments_default_not_archived",
      sql`not (${t.isDefault} and ${t.archivedAt} is not null)`,
    ),
    check("departments_archived_by", sql`(${t.archivedAt} is null) = (${t.archivedBy} is null)`),
  ],
);

/**
 * Installed licenses (ADR-0030), append-only: `mustawfi_app` may only insert and read, and a
 * trigger refuses any change or deletion by anyone (`0005_licenses_rules.sql`). The current
 * license is the newest installed. The claims are copied into columns for queries; `jws`, as
 * issued, stays the source.
 */
export const licenses = coreTenancy.table(
  "licenses",
  {
    id: uuid().primaryKey(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    branchId: uuid().notNull(),
    jws: text().notNull(),
    kid: text().notNull(),
    plan: text().notNull(),
    issuedAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    notBefore: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    expiresAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    graceDays: integer().notNull(),
    readOnlyDays: integer().notNull(),
    maxOfflineDays: integer().notNull(),
    limits: jsonb().notNull(),
    entitlements: jsonb().notNull(),
    installedAt: timestamp({ withTimezone: true }).notNull(),
    /** The user who installed it; null when Vertex staff did (CLI, later the control plane). */
    installedBy: uuid(),
  },
  (t) => [
    uniqueIndex("licenses_one_per_issue").on(t.tenantId, t.issuedAt),
    check("licenses_expiry_after_validity", sql`${t.expiresAt} > ${t.notBefore}`),
    check(
      "licenses_days",
      sql`${t.graceDays} >= 0 and ${t.readOnlyDays} >= 0 and ${t.maxOfflineDays} >= 1`,
    ),
  ],
);
