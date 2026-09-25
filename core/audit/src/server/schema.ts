import { index, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `core_audit` tables (non-negotiable 10, ADR-0016). Internal to the module: no entry exports
 * them. Append-only: `mustawfi_app` may only insert and read, and a trigger refuses any
 * change or deletion by anyone (`0001_audit_rls.sql`).
 */
export const coreAudit = pgSchema("core_audit");

export const entries = coreAudit.table(
  "entries",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_audit_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When it happened. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** Who acted; null only when no known user did (a sign-in naming an unknown login). */
    createdBy: uuid(),
    /** The device it happened on, when one was involved. */
    deviceId: uuid(),
    /** What happened: a dotted camelCase code, `module.subject.event` (`access.login.succeeded`). */
    action: text().notNull(),
    /** The record acted on, when there is one (`access.user`, its id). */
    entityType: text(),
    entityId: uuid(),
    /** Snapshots of the values before and after, secrets left out. */
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [index("entries_by_time").on(t.tenantId, t.createdAt)],
);
