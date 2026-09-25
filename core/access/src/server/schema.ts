import { boolean, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * `core_access` tables (ADR-0016, ADR-0022). Internal to the module: no entry exports them.
 * Sessions, devices, and registration codes join in the walking skeleton's slice 6.
 */
export const coreAccess = pgSchema("core_access");

export const users = coreAccess.table(
  "users",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_access_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    /** Normalized to lower case; unique within the tenant. */
    login: text().notNull(),
    /** Argon2id PHC string; the password itself is never stored. */
    passwordHash: text().notNull(),
    isOwner: boolean().notNull(),
  },
  (t) => [unique("users_login_per_tenant").on(t.tenantId, t.login)],
);
