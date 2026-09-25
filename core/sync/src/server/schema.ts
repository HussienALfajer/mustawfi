import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { SyncValues } from "../shared/index.ts";

/**
 * `core_sync` tables (ADR-0020). Internal to the module: no entry exports them. Received
 * operations and changes are append-only: `mustawfi_app` may only insert and read them, and
 * triggers refuse any change or deletion by anyone (`0001_sync_rls.sql`).
 */
export const coreSync = pgSchema("core_sync");

/** Every operation a device pushed, accepted or rejected, keyed by its `opId`. */
export const receivedOps = coreSync.table(
  "received_ops",
  {
    /** The operation's `opId`, generated on the device. */
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_sync_rls.sql`). */
    tenantId: uuid().notNull(),
    /** The device's branch. */
    branchId: uuid().notNull(),
    /** When the server received it (ADR-0020: the server records its own receipt time). */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** The user the operation names; not a foreign key, as a rejected one may name anyone. */
    createdBy: uuid().notNull(),
    /** References `core_access.devices` (FK in `0001_sync_rls.sql`). */
    deviceId: uuid().notNull(),
    deviceSeq: bigint({ mode: "number" }).notNull(),
    type: text().notNull(),
    payloadVersion: integer().notNull(),
    shiftId: uuid().notNull(),
    /** The device's clock when the operation was created. */
    deviceCreatedAt: timestamp({ withTimezone: true }).notNull(),
    /** The payload as received: an immutable snapshot. */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** `accepted` or `rejected`. */
    status: text().notNull(),
    /** What the handler answered an accepted operation with. */
    result: jsonb().$type<SyncValues>(),
    problemCode: text(),
    problemDetail: text(),
  },
  (t) => [
    unique("received_ops_device_seq").on(t.tenantId, t.deviceId, t.deviceSeq),
    check("received_ops_device_seq_positive", sql`${t.deviceSeq} > 0`),
    check(
      "received_ops_outcome",
      sql`(${t.status} = 'accepted' and ${t.result} is not null and ${t.problemCode} is null)
        or (${t.status} = 'rejected' and ${t.result} is null and ${t.problemCode} is not null)`,
    ),
  ],
);

/**
 * The tenant's change log of data that flows down (ADR-0020): one row per change, numbered by
 * `tenant_counters` inside the writing transaction, so commit order equals `seq` order.
 */
export const changes = coreSync.table(
  "changes",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** Gapless per tenant, from 1. */
    seq: bigint({ mode: "number" }).notNull(),
    /** `inventory.product`… */
    entity: text().notNull(),
    entityId: uuid().notNull(),
    /** The entity's full row after the change; `null` for a tombstone. */
    row: jsonb().$type<SyncValues>(),
  },
  (t) => [
    unique("changes_seq_per_tenant").on(t.tenantId, t.seq),
    check("changes_seq_positive", sql`${t.seq} > 0`),
  ],
);

/**
 * One row per tenant: the last `seq` of its change log. Incrementing it locks the row until
 * the writing transaction ends, which serializes change-log writes per tenant.
 */
export const tenantCounters = coreSync.table(
  "tenant_counters",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull().unique(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    changeSeq: bigint({ mode: "number" }).notNull(),
  },
  (t) => [check("tenant_counters_change_seq_positive", sql`${t.changeSeq} > 0`)],
);
