import type { PullApplier, SyncFollowUp } from "@mustawfi/core-sync/client";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { asc, eq, isNull } from "drizzle-orm";
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  DEPARTMENT_ENTITY,
  departmentSchema,
  type DepartmentView,
  type LogoPrintMode,
  type LogoType,
  STORE_PROFILE_ENTITY,
  storeProfileSchema,
  type StoreProfileView,
} from "../shared/index.ts";
import { fetchDeviceLogo } from "./store-profile/queries.ts";

/**
 * Departments as the server last sent them (server-authoritative master data, ADR-0005),
 * archived ones included: documents keep naming them.
 */
const localDepartments = sqliteTable("organization_departments", {
  id: text().primaryKey(),
  name: text().notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  sortOrder: safeInteger("sort_order").notNull(),
  archivedAt: text("archived_at"),
});

/** The store profile as the server last sent it, without the logo's bytes. */
const localStoreProfile = sqliteTable("organization_store_profile", {
  id: text().primaryKey(),
  name: text().notNull(),
  address: text(),
  /** JSON array of up to three phone numbers. */
  phones: text().notNull(),
  taxNumber: text("tax_number"),
  commercialRegister: text("commercial_register"),
  logoType: text("logo_type"),
  logoSha256: text("logo_sha256"),
  logoSize: safeInteger("logo_size"),
  logoPrint: text("logo_print").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Bytes as the local database adapters hand them over (`LocalValue`): no conversion. */
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "blob",
});

/**
 * The store's logo, fetched after a sync round when the pulled profile names another one, and
 * kept only when its bytes hash to what the profile says: receipts print it offline.
 */
const localStoreLogo = sqliteTable("organization_store_logo", {
  sha256: text().primaryKey(),
  type: text().notNull(),
  bytes: bytes().notNull(),
});

export const LOCAL_DEPARTMENTS_TABLE = "organization_departments";
export const LOCAL_STORE_PROFILE_TABLE = "organization_store_profile";
export const LOCAL_STORE_LOGO_TABLE = "organization_store_logo";

/** `core.organization`'s local schema (ADR-0019). */
export const organizationLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.organization.0001_departments_and_profile",
    statements: [
      `CREATE TABLE organization_departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        sort_order INTEGER NOT NULL,
        archived_at TEXT
      ) STRICT`,
      `CREATE TABLE organization_store_profile (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        phones TEXT NOT NULL,
        tax_number TEXT,
        commercial_register TEXT,
        logo_type TEXT,
        logo_sha256 TEXT,
        logo_size INTEGER,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
];

/**
 * `core-foundation` slice 21: how receipts print the logo, and the logo itself. Its own list,
 * since devices match applied migrations by position: the app appends it at the end of
 * `LOCAL_MIGRATIONS`.
 */
export const storeLogoLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.organization.0002_store_logo",
    statements: [
      `ALTER TABLE organization_store_profile
        ADD COLUMN logo_print TEXT NOT NULL DEFAULT 'threshold'
        CHECK (logo_print IN ('threshold', 'dither'))`,
      `CREATE TABLE organization_store_logo (
        sha256 TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg')),
        bytes BLOB NOT NULL
      ) STRICT`,
    ],
  },
];

type LocalStoreProfileRow = typeof localStoreProfile.$inferSelect;

function storeProfileView(row: LocalStoreProfileRow): StoreProfileView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phones: JSON.parse(row.phones) as string[],
    // Only the profile screen shows these, from the server; receipts leave them out.
    unreadablePhones: [],
    taxNumber: row.taxNumber,
    commercialRegister: row.commercialRegister,
    logo:
      row.logoType === null || row.logoSha256 === null || row.logoSize === null
        ? null
        : { type: row.logoType as LogoType, sha256: row.logoSha256, size: row.logoSize },
    logoPrint: row.logoPrint as LogoPrintMode,
    updatedAt: row.updatedAt,
  };
}

/** Applies pulled `organization.department` changes: the full row, or a tombstone. */
export const departmentPullApplier: PullApplier = {
  entity: DEPARTMENT_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localDepartments).where(eq(localDepartments.id, change.id));
      return;
    }
    const { id, ...row } = departmentSchema.parse(change.row);
    await orm
      .insert(localDepartments)
      .values({ id, ...row })
      .onConflictDoUpdate({ target: localDepartments.id, set: row });
  },
};

/** Applies pulled `organization.storeProfile` changes: the full row, or a tombstone. */
export const storeProfilePullApplier: PullApplier = {
  entity: STORE_PROFILE_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localStoreProfile).where(eq(localStoreProfile.id, change.id));
      return;
    }
    const profile = storeProfileSchema.parse(change.row);
    const row = {
      name: profile.name,
      address: profile.address,
      phones: JSON.stringify(profile.phones),
      taxNumber: profile.taxNumber,
      commercialRegister: profile.commercialRegister,
      logoType: profile.logo?.type ?? null,
      logoSha256: profile.logo?.sha256 ?? null,
      logoSize: profile.logo?.size ?? null,
      logoPrint: profile.logoPrint,
      updatedAt: profile.updatedAt,
    };
    await orm
      .insert(localStoreProfile)
      .values({ id: profile.id, ...row })
      .onConflictDoUpdate({ target: localStoreProfile.id, set: row });
  },
};

/** The pull appliers of `core.organization`, for the app's sync engine. */
export const organizationPullAppliers: readonly PullApplier[] = [
  departmentPullApplier,
  storeProfilePullApplier,
];

/** The departments on this device in their order; archived ones only when asked. */
export async function listLocalDepartments(
  executor: LocalExecutor,
  options: { readonly includeArchived?: boolean } = {},
): Promise<DepartmentView[]> {
  return localOrm(executor)
    .select()
    .from(localDepartments)
    .where(options.includeArchived === true ? undefined : isNull(localDepartments.archivedAt))
    .orderBy(asc(localDepartments.sortOrder), asc(localDepartments.id));
}

/**
 * The store's default department on this device, once pulled: what documents are made under
 * until `sales` chooses by the user's scope (`core-foundation` rule 32).
 */
export async function localDefaultDepartment(
  executor: LocalExecutor,
): Promise<DepartmentView | undefined> {
  return localOrm(executor)
    .select()
    .from(localDepartments)
    .where(eq(localDepartments.isDefault, true))
    .get();
}

/** The store profile on this device, once pulled. */
export async function readLocalStoreProfile(
  executor: LocalExecutor,
): Promise<StoreProfileView | undefined> {
  const row = await localOrm(executor).select().from(localStoreProfile).get();
  return row === undefined ? undefined : storeProfileView(row);
}

/** Lower-case hex SHA-256 of `bytes`. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Brings the device's copy of the logo in line with the pulled profile: fetches it when the
 * profile names another one, and keeps it only when its bytes hash to the profile's `sha256`
 * (a logo changed again since the pull is fetched at the next round); forgets it when the
 * profile has none. Returns whether the stored logo changed.
 */
export async function refreshLocalStoreLogo(
  db: LocalDb,
  fetchLogo: () => Promise<Uint8Array>,
): Promise<boolean> {
  const orm = localOrm(db);
  const wanted = (await readLocalStoreProfile(db))?.logo ?? null;
  const held = await orm.select({ sha256: localStoreLogo.sha256 }).from(localStoreLogo).get();
  if (wanted === null) {
    if (held === undefined) return false;
    await orm.delete(localStoreLogo);
    return true;
  }
  if (held?.sha256 === wanted.sha256) return false;
  const bytes = await fetchLogo();
  if ((await sha256Hex(bytes)) !== wanted.sha256) return false;
  await db.transaction(async (tx) => {
    const txOrm = localOrm(tx);
    await txOrm.delete(localStoreLogo);
    await txOrm.insert(localStoreLogo).values({ sha256: wanted.sha256, type: wanted.type, bytes });
  });
  return true;
}

/** The sync engine's follow-up that keeps the logo on this device (`refreshLocalStoreLogo`). */
export function storeLogoFollowUp(db: LocalDb): SyncFollowUp {
  return (credential) => refreshLocalStoreLogo(db, () => fetchDeviceLogo(credential));
}

/**
 * The logo receipts print on this device: the stored image when it is the one the local
 * profile names, else `undefined` (none, or not fetched yet).
 */
export async function readLocalStoreLogo(
  executor: LocalExecutor,
): Promise<{ readonly type: LogoType; readonly bytes: Uint8Array } | undefined> {
  const wanted = (await readLocalStoreProfile(executor))?.logo ?? null;
  if (wanted === null) return undefined;
  const row = await localOrm(executor)
    .select()
    .from(localStoreLogo)
    .where(eq(localStoreLogo.sha256, wanted.sha256))
    .get();
  return row === undefined ? undefined : { type: row.type as LogoType, bytes: row.bytes };
}

export const localDepartmentsQueryKey = ["local", "organization", "departments"] as const;
export const localStoreProfileQueryKey = ["local", "organization", "storeProfile"] as const;

export function localDepartmentsQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localDepartmentsQueryKey,
    queryFn: () => listLocalDepartments(db),
    networkMode: "always",
    meta: { localTables: [LOCAL_DEPARTMENTS_TABLE] },
  });
}

export function localStoreProfileQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localStoreProfileQueryKey,
    queryFn: async () => (await readLocalStoreProfile(db)) ?? null,
    networkMode: "always",
    meta: { localTables: [LOCAL_STORE_PROFILE_TABLE] },
  });
}
