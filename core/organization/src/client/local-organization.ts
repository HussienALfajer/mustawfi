import type { PullApplier } from "@mustawfi/core-sync/client";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { asc, eq, isNull } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  DEPARTMENT_ENTITY,
  departmentSchema,
  type DepartmentView,
  type LogoType,
  STORE_PROFILE_ENTITY,
  storeProfileSchema,
  type StoreProfileView,
} from "../shared/index.ts";

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
  updatedAt: text("updated_at").notNull(),
});

export const LOCAL_DEPARTMENTS_TABLE = "organization_departments";
export const LOCAL_STORE_PROFILE_TABLE = "organization_store_profile";

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

type LocalStoreProfileRow = typeof localStoreProfile.$inferSelect;

function storeProfileView(row: LocalStoreProfileRow): StoreProfileView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phones: JSON.parse(row.phones) as string[],
    taxNumber: row.taxNumber,
    commercialRegister: row.commercialRegister,
    logo:
      row.logoType === null || row.logoSha256 === null || row.logoSize === null
        ? null
        : { type: row.logoType as LogoType, sha256: row.logoSha256, size: row.logoSize },
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

/** The store profile on this device, once pulled. */
export async function readLocalStoreProfile(
  executor: LocalExecutor,
): Promise<StoreProfileView | undefined> {
  const row = await localOrm(executor).select().from(localStoreProfile).get();
  return row === undefined ? undefined : storeProfileView(row);
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
