import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `core_access` tables (ADR-0016, ADR-0022). Internal to the module: no entry exports them.
 * Secrets are never stored: sessions, device credentials, and registration codes keep only
 * the SHA-256 of theirs, in lowercase hex.
 */
export const coreAccess = pgSchema("core_access");

const SHA256_HEX = "'^[0-9a-f]{64}$'";

/**
 * Roles (`core-foundation` rules 13–16): one fixed owner role per tenant, and editable roles
 * seeded from the templates or copied from another role. Archived, never deleted.
 */
export const roles = coreAccess.table(
  "roles",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0006_roles_rules.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    name: text().notNull(),
    /** `owner`, a template the role was seeded from, or null for a copy; never changes. */
    template: text(),
    /** Holds every permission, no scope, no limit; never changes, never archived. */
    isOwner: boolean().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    archivedBy: uuid(),
  },
  (t) => [
    unique("roles_id_per_tenant").on(t.tenantId, t.id),
    check(
      "roles_template",
      sql`${t.template} in ('owner', 'accountant', 'sectionCashier', 'repairTechnician', 'topUpOperator')`,
    ),
    check("roles_owner_template", sql`${t.isOwner} = (${t.template} is not distinct from 'owner')`),
    check("roles_owner_not_archived", sql`not (${t.isOwner} and ${t.archivedAt} is not null)`),
    check("roles_archived_by", sql`(${t.archivedAt} is null) = (${t.archivedBy} is null)`),
    uniqueIndex("roles_one_owner_per_tenant")
      .on(t.tenantId)
      .where(sql`${t.isOwner}`),
    uniqueIndex("roles_active_name_per_tenant")
      .on(t.tenantId, t.name)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** The permissions a role holds (the owner role holds all, with no rows). */
export const rolePermissions = coreAccess.table(
  "role_permissions",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** Tenant-scoped FK to `roles` in `0006_roles_rules.sql`. */
    roleId: uuid().notNull(),
    /** A permission some module declares; checked when written, not by the database. */
    permission: text().notNull(),
  },
  (t) => [unique("role_permissions_once").on(t.tenantId, t.roleId, t.permission)],
);

/** A role's limit values; a limit without a row is zero for that role (rule 16). */
export const roleLimits = coreAccess.table(
  "role_limits",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    roleId: uuid().notNull(),
    /** A limit some module declares (`limit` is a reserved word in SQL). */
    limitId: text().notNull(),
    value: numeric({ precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    unique("role_limits_once").on(t.tenantId, t.roleId, t.limitId),
    check("role_limits_value", sql`${t.value} >= 0`),
  ],
);

/**
 * The template grants a role seeded from a template has received or declined
 * (`core-foundation` slice 6, user decision 2026-09-26). A permission or limit a module grants
 * the role's template, and that has no row here, is held by the role although it has no
 * `role_permissions` or `role_limits` row: that is how a permission declared after the tenant
 * was created reaches its template's role. Editing the role records every current template
 * grant here, so a permission the editor removed stays removed.
 */
export const roleTemplateGrants = coreAccess.table(
  "role_template_grants",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** Tenant-scoped FK to `roles` in `0008_users_and_roles_rules.sql`. */
    roleId: uuid().notNull(),
    kind: text().notNull(),
    /** A permission or limit id. */
    grantId: text().notNull(),
  },
  (t) => [
    unique("role_template_grants_once").on(t.tenantId, t.roleId, t.kind, t.grantId),
    check("role_template_grants_kind", sql`${t.kind} in ('permission', 'limit')`),
  ],
);

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
    /**
     * Normalized to lower case; unique within the tenant. Null for a user who signs in only by
     * PIN on a registered device (flow 8).
     */
    login: text(),
    /** Argon2id PHC string; the password itself is never stored. Optional (rule 19). */
    passwordHash: text(),
    /** Exactly one role per user (rule 15); tenant-scoped FK in `0006_roles_rules.sql`. */
    roleId: uuid().notNull(),
    /** `all` departments, or those `listed` in `user_departments`. */
    departmentScope: text().notNull(),
    /** `active` or `deactivated`; users are deactivated, never deleted. */
    status: text().notNull().default("active"),
    /**
     * Argon2id PHC string of the user's PIN (rule 19). Null only for a tenant's first owner
     * until they set one: `tenant:create` takes no PIN.
     */
    pinVerifier: text(),
    pinChangedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("users_login_per_tenant").on(t.tenantId, t.login),
    unique("users_id_per_tenant").on(t.tenantId, t.id),
    check("users_department_scope", sql`${t.departmentScope} in ('all', 'listed')`),
    check("users_status", sql`${t.status} in ('active', 'deactivated')`),
    check("users_password_needs_login", sql`${t.passwordHash} is null or ${t.login} is not null`),
    check("users_pin_changed_at", sql`(${t.pinVerifier} is null) = (${t.pinChangedAt} is null)`),
    check("users_password_argon2id", sql`${t.passwordHash} like '$argon2id$%'`),
    check("users_pin_argon2id", sql`${t.pinVerifier} like '$argon2id$%'`),
  ],
);

/** The departments of a user whose scope is `listed`. */
export const userDepartments = coreAccess.table(
  "user_departments",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** Tenant-scoped FKs to `users` and `core_tenancy.departments` in `0006_roles_rules.sql`. */
    userId: uuid().notNull(),
    departmentId: uuid().notNull(),
  },
  (t) => [unique("user_departments_once").on(t.tenantId, t.userId, t.departmentId)],
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
    /**
     * Set once, by revoke (`core-foundation` rule 23), with who and why; never cleared. A
     * revoked device's credential is refused everywhere but push.
     */
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid(),
    revokeReason: text(),
    /** When the revoked device reported that it wiped its local data, if it could. */
    wipedAt: timestamp({ withTimezone: true }),
    /** The server's time of the device's last push or pull. */
    lastSyncAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("devices_prefix_per_tenant").on(t.tenantId, t.prefix),
    check("devices_type", sql`${t.type} in ('mainPos', 'companion')`),
    check("devices_prefix_format", sql`${t.prefix} ~ '^[A-HJ-NP-Z2-9]{2}$'`),
    check("devices_credential_hash_format", sql`${t.credentialHash} ~ ${sql.raw(SHA256_HEX)}`),
    check(
      "devices_revoke_complete",
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null) and (${t.revokedAt} is null) = (${t.revokeReason} is null)`,
    ),
    check("devices_wiped_after_revoke", sql`${t.wipedAt} is null or ${t.revokedAt} is not null`),
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
    /** How the user proved who they are: `password` or `pin` (online PIN on a registered device). */
    method: text().notNull().default("password"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid(),
  },
  (t) => [
    check("sessions_token_hash_format", sql`${t.tokenHash} ~ ${sql.raw(SHA256_HEX)}`),
    check("sessions_method", sql`${t.method} in ('password', 'pin')`),
    check("sessions_pin_on_device", sql`${t.method} <> 'pin' or ${t.deviceId} is not null`),
  ],
);

/**
 * Failed sign-ins, counted for rate limiting (`core-foundation` rule 21): per typed login for
 * password sign-in, per user and device for online PIN sign-in. Pruned by age and cleared by a
 * success; not audit data (every attempt is audited in `core_audit`). The per-source-address
 * count lives in the server's memory, since an address may name no tenant.
 */
export const loginAttempts = coreAccess.table(
  "login_attempts",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When the failure happened. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** Null: a failed attempt proves no one. */
    createdBy: uuid(),
    /** `password` or `pin`. */
    method: text().notNull(),
    /**
     * SHA-256 of the login as typed, normalized, for password sign-in: unknown logins count
     * too, and the typed text is not kept (people type passwords into the login field).
     */
    loginHash: text(),
    /** The user and device a PIN was tried for. PIN sign-in only. */
    userId: uuid(),
    deviceId: uuid(),
  },
  (t) => [
    check("login_attempts_method", sql`${t.method} in ('password', 'pin')`),
    check(
      "login_attempts_key",
      sql`(${t.method} = 'password' and ${t.loginHash} is not null and ${t.userId} is null and ${t.deviceId} is null)
        or (${t.method} = 'pin' and ${t.loginHash} is null and ${t.userId} is not null and ${t.deviceId} is not null)`,
    ),
    check("login_attempts_login_hash_format", sql`${t.loginHash} ~ ${sql.raw(SHA256_HEX)}`),
    index("login_attempts_by_login").on(t.tenantId, t.loginHash, t.createdAt),
    index("login_attempts_by_pin").on(t.tenantId, t.userId, t.deviceId, t.createdAt),
  ],
);

/**
 * One-time codes Vertex support issues so an owner can set a new password (`core-foundation`
 * rule 27). Only the hash is stored; a code works once, for thirty minutes.
 */
export const resetCodes = coreAccess.table(
  "reset_codes",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** Null: no user of the tenant issues it (`issuedBy` names the support staff member). */
    createdBy: uuid(),
    /** True for every code today: support issues them through the staff CLI. */
    issuedBySupport: boolean().notNull(),
    /** The support staff member who issued it, as the CLI was told. */
    issuedBy: text().notNull(),
    /** The owner it lets back in; tenant-scoped FK in `0010_sign_in_rules.sql`. */
    userId: uuid().notNull(),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Set once, when the owner uses it; a used code never works again. */
    usedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("reset_codes_hash_per_tenant").on(t.tenantId, t.codeHash),
    check("reset_codes_hash_format", sql`${t.codeHash} ~ ${sql.raw(SHA256_HEX)}`),
  ],
);
