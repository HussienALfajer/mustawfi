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
    // Target of the operation flags' tenant-scoped foreign key.
    unique("received_ops_id_per_tenant").on(t.tenantId, t.id),
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

/**
 * What the server flagged on an accepted operation, whatever its document type (ADR-0030):
 * append-only, written in the operation's transaction by the module that found it.
 */
export const operationFlags = coreSync.table(
  "operation_flags",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When the server received the operation. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** The user the operation names. */
    createdBy: uuid().notNull(),
    /**
     * The flagged operation. Written before the operation's own row in the same transaction, so
     * its tenant-scoped foreign key is deferred to commit (`0003_operation_flags_rules.sql`).
     */
    opId: uuid().notNull(),
    code: text().notNull(),
    /** What was found, as a snapshot: the missing numbers of a gap… */
    detail: jsonb().$type<SyncValues>().notNull(),
  },
  (t) => [
    unique("operation_flags_code_per_op").on(t.tenantId, t.opId, t.code),
    check(
      "operation_flags_code",
      sql`${t.code} in ('deviceRevoked', 'licenseReadOnly', 'permissionMissing', 'overrideNotAuthorized', 'numberGap')`,
    ),
  ],
);

/**
 * The configuration bundle each device was last offered (ADR-0030, `core-foundation` rule 12):
 * its version increases whenever the digest of its parts changes, so a device holding the
 * current version gets no bundle, and one that does not gets the new one. Server state, not a
 * record: `mustawfi_app` may update it, and a trigger keeps the version moving forward.
 */
export const bundleVersions = coreSync.table(
  "bundle_versions",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** Null: the server builds bundles, no user does. */
    createdBy: uuid(),
    /** References `core_access.devices` (FK in `0005_bundle_versions_rules.sql`). */
    deviceId: uuid().notNull(),
    version: bigint({ mode: "number" }).notNull(),
    /** `bundleDigest` of the parts this version was built from. */
    digest: text().notNull(),
    /** The manifest's `issuedAt` for this version, so each version signs the same manifest. */
    issuedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique("bundle_versions_device").on(t.tenantId, t.deviceId),
    check("bundle_versions_version_positive", sql`${t.version} > 0`),
  ],
);
