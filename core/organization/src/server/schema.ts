import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `core_organization` tables (ADR-0016). Internal to the module: no entry exports them.
 * Departments live in `core_tenancy` (ADR-0030); this module manages them through its interface.
 */
export const coreOrganization = pgSchema("core_organization");

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * The store profile, one row per tenant, created with it: what receipts and documents show.
 * Edited, never deleted.
 */
export const storeProfiles = coreOrganization.table(
  "store_profiles",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_store_profiles_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    address: text(),
    /** Up to three, as people write them. */
    phones: text().array().notNull(),
    taxNumber: text(),
    commercialRegister: text(),
    /** PNG or JPEG, at most 256 KB; `logo_type`, `logo_sha256`, and `logo_size` describe it. */
    logo: bytea(),
    logoType: text(),
    logoSha256: text(),
    logoSize: integer(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    updatedBy: uuid().notNull(),
  },
  (t) => [
    unique("store_profiles_one_per_tenant").on(t.tenantId),
    check("store_profiles_phones", sql`cardinality(${t.phones}) <= 3`),
    check(
      "store_profiles_logo",
      sql`(${t.logo} is null and ${t.logoType} is null and ${t.logoSha256} is null and ${t.logoSize} is null)
        or (${t.logoType} in ('image/png', 'image/jpeg') and ${t.logoSha256} ~ '^[0-9a-f]{64}$'
          and ${t.logoSize} = octet_length(${t.logo}) and ${t.logoSize} between 1 and 262144)`,
    ),
  ],
);

/**
 * The server's view of each device's numbering (ADR-0020, `core-foundation` rule 31): the
 * highest sequence received per device and document code. Moves forward only, one document at
 * a time, under the device's push lock; a jump is a gap, flagged and audited.
 */
export const documentSequences = coreOrganization.table(
  "document_sequences",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When the device's first document with this code arrived. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** References `core_access.devices` (FK in `0003_document_sequences_rules.sql`). */
    deviceId: uuid().notNull(),
    docCode: text().notNull(),
    lastSeq: bigint({ mode: "number" }).notNull(),
    /** When the last sequence moved. */
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique("document_sequences_per_device_code").on(t.tenantId, t.deviceId, t.docCode),
    check("document_sequences_doc_code", sql`${t.docCode} ~ '^[A-Z]{3}$'`),
    check("document_sequences_last_seq_positive", sql`${t.lastSeq} > 0`),
  ],
);
