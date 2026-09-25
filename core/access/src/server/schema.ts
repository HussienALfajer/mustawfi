import { sql } from "drizzle-orm";
import { boolean, check, pgSchema, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * `core_access` tables (ADR-0016, ADR-0022). Internal to the module: no entry exports them.
 * Secrets are never stored: sessions, device credentials, and registration codes keep only
 * the SHA-256 of theirs, in lowercase hex.
 */
export const coreAccess = pgSchema("core_access");

const SHA256_HEX = "'^[0-9a-f]{64}$'";

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

/** One-time codes an owner issues so a new device can register (ADR-0022). */
export const registrationCodes = coreAccess.table(
  "registration_codes",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** The owner who issued it. */
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Set once, when a device registers with it; a used code never works again. */
    usedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("registration_codes_hash_per_tenant").on(t.tenantId, t.codeHash),
    check("registration_codes_hash_format", sql`${t.codeHash} ~ ${sql.raw(SHA256_HEX)}`),
  ],
);

/** Registered devices, each with its document-number prefix (ADR-0020) and credential. */
export const devices = coreAccess.table(
  "devices",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** The owner who issued the registration code. */
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    /** `mainPos` or `companion` (glossary: main POS device, mobile companion device). */
    type: text().notNull(),
    /**
     * Two symbols without `I`, `O`, `0`, `1`; unique within the tenant, and never reused
     * because a device row is never deleted (ADR-0020).
     */
    prefix: text().notNull(),
    credentialHash: text().notNull().unique(),
    /** The code it registered with: one device per code. */
    registrationCodeId: uuid()
      .notNull()
      .unique()
      .references(() => registrationCodes.id),
  },
  (t) => [
    unique("devices_prefix_per_tenant").on(t.tenantId, t.prefix),
    check("devices_type", sql`${t.type} in ('mainPos', 'companion')`),
    check("devices_prefix_format", sql`${t.prefix} ~ '^[A-HJ-NP-Z2-9]{2}$'`),
    check("devices_credential_hash_format", sql`${t.credentialHash} ~ ${sql.raw(SHA256_HEX)}`),
  ],
);

/** Opaque server-side sessions (ADR-0022): revocation takes effect on the next request. */
export const sessions = coreAccess.table(
  "sessions",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    /** The registered device it was opened on; null in a browser without one. */
    deviceId: uuid().references(() => devices.id),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid(),
  },
  (t) => [check("sessions_token_hash_format", sql`${t.tokenHash} ~ ${sql.raw(SHA256_HEX)}`)],
);
