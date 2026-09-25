import { ProblemError } from "@mustawfi/core-config/server";
import { and, asc, count, eq, inArray, isNull, max } from "drizzle-orm";
import { departmentNameSchema, type DepartmentView, tenancyProblemCodes } from "../shared/index.ts";
import { currentLicense } from "./licenses.ts";
import { departments, tenants } from "./schema.ts";
import type { TenantTransaction } from "./tenant-database.ts";
import { currentTenant } from "./tenants.ts";

type DepartmentRow = typeof departments.$inferSelect;

function toView(row: DepartmentRow): DepartmentView {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** Whether `error` is a unique violation of `constraint`, through the driver's wrapping. */
function violates(error: unknown, constraint: string): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    const fields = e as { code?: unknown; constraint?: unknown };
    if (fields.code === "23505") return fields.constraint === constraint;
  }
  return false;
}

function nameTaken(error: unknown): unknown {
  if (!violates(error, "departments_active_name_per_tenant")) return error;
  return new ProblemError(tenancyProblemCodes.departmentNameTaken, 409, {
    title: "Another active department has this name",
    cause: error,
  });
}

/**
 * Department changes of one tenant run one at a time: the limit and the last-active rule
 * count rows another transaction could be changing.
 */
async function lockTenant(tx: TenantTransaction): Promise<{ tenantId: string; branchId: string }> {
  await tx.select({ id: tenants.id }).from(tenants).for("update");
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("no tenant in this context");
  return { tenantId: tenant.id, branchId: tenant.defaultBranchId };
}

async function activeCount(tx: TenantTransaction): Promise<number> {
  const [row] = await tx
    .select({ active: count() })
    .from(departments)
    .where(isNull(departments.archivedAt));
  return row?.active ?? 0;
}

async function existing(tx: TenantTransaction, id: string): Promise<DepartmentRow> {
  const [row] = await tx.select().from(departments).where(eq(departments.id, id)).for("update");
  if (row === undefined) {
    throw new ProblemError(tenancyProblemCodes.departmentNotFound, 404, {
      title: "No such department",
    });
  }
  if (row.archivedAt !== null) {
    throw new ProblemError(tenancyProblemCodes.departmentArchived, 409, {
      title: "The department is archived",
    });
  }
  return row;
}

export interface NewDefaultDepartment {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/** The tenant's default department, written by `createTenant` in its transaction. */
export async function insertDefaultDepartment(
  tx: TenantTransaction,
  department: NewDefaultDepartment,
): Promise<void> {
  await tx.insert(departments).values({
    ...department,
    name: departmentNameSchema.parse(department.name),
    isDefault: true,
    sortOrder: 0,
  });
}

export interface NewDepartment {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Adds an active department to the tenant `tx` runs in, last in order. Refused with a 409
 * `tenancy.limit.departments` when the tenant already has as many active departments as its
 * license allows (archived ones do not count, rule 4), and `tenancy.department.nameTaken` when
 * another active department has the name. The caller audits and publishes the change.
 */
export async function createDepartment(
  tx: TenantTransaction,
  department: NewDepartment,
): Promise<DepartmentView> {
  const name = departmentNameSchema.parse(department.name);
  const { tenantId, branchId } = await lockTenant(tx);
  const license = await currentLicense(tx);
  if (license === undefined) throw new Error("the tenant has no license");
  const allowed = license.claims.limits.departments;
  if ((await activeCount(tx)) >= allowed) {
    throw new ProblemError(tenancyProblemCodes.departmentLimit, 409, {
      title: "The license's department limit is reached",
      detail: `the license allows ${allowed} active departments`,
    });
  }
  const [last] = await tx.select({ sortOrder: max(departments.sortOrder) }).from(departments);
  try {
    const [row] = await tx
      .insert(departments)
      .values({
        id: department.id,
        tenantId,
        branchId,
        createdAt: department.createdAt,
        createdBy: department.createdBy,
        name,
        isDefault: false,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      })
      .returning();
    if (row === undefined) throw new Error("the department insert returned no row");
    return toView(row);
  } catch (error) {
    throw nameTaken(error);
  }
}

/** A department before and after a change, for the audit log and the change log. */
export interface DepartmentChange {
  readonly before: DepartmentView;
  readonly after: DepartmentView;
}

/** Renames an active department, the default included. The caller audits and publishes. */
export async function renameDepartment(
  tx: TenantTransaction,
  change: { readonly id: string; readonly name: string },
): Promise<DepartmentChange> {
  const name = departmentNameSchema.parse(change.name);
  const before = await existing(tx, change.id);
  try {
    const [row] = await tx
      .update(departments)
      .set({ name })
      .where(eq(departments.id, change.id))
      .returning();
    if (row === undefined) throw new Error("the department update returned no row");
    return { before: toView(before), after: toView(row) };
  } catch (error) {
    throw nameTaken(error);
  }
}

/**
 * Archives an active department (rule 28): never the default one, never the last active one.
 * The caller audits and publishes.
 */
export async function archiveDepartment(
  tx: TenantTransaction,
  change: { readonly id: string; readonly archivedAt: Date; readonly archivedBy: string },
): Promise<DepartmentChange> {
  await lockTenant(tx);
  const before = await existing(tx, change.id);
  // The last-active rule first: while the default is never archived it is also the last active
  // one, and "last active" is the reason that holds whichever department it is.
  if ((await activeCount(tx)) <= 1) {
    throw new ProblemError(tenancyProblemCodes.lastActiveDepartment, 409, {
      title: "The last active department cannot be archived",
    });
  }
  if (before.isDefault) {
    throw new ProblemError(tenancyProblemCodes.defaultDepartment, 409, {
      title: "The default department cannot be archived",
    });
  }
  const [row] = await tx
    .update(departments)
    .set({ archivedAt: change.archivedAt, archivedBy: change.archivedBy })
    .where(and(eq(departments.id, change.id), isNull(departments.archivedAt)))
    .returning();
  if (row === undefined) throw new Error("the department update returned no row");
  return { before: toView(before), after: toView(row) };
}

/** The tenant's departments, archived ones included, in their order. */
export async function listDepartments(tx: TenantTransaction): Promise<DepartmentView[]> {
  const rows = await tx
    .select()
    .from(departments)
    .orderBy(asc(departments.sortOrder), asc(departments.id));
  return rows.map(toView);
}

/** The tenant's default department. */
export async function defaultDepartment(tx: TenantTransaction): Promise<DepartmentView> {
  const [row] = await tx.select().from(departments).where(eq(departments.isDefault, true));
  if (row === undefined) throw new Error("the tenant has no default department");
  return toView(row);
}

/** Which of `ids` name an active (not archived) department of the tenant. */
export async function activeDepartments(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(inArray(departments.id, [...new Set(ids)]), isNull(departments.archivedAt)));
  return new Set(rows.map((row) => row.id));
}

/**
 * Which of `ids` name a department of the tenant, archived ones included: a document keeps
 * the department it was made in (`core-foundation` rule 28).
 */
export async function knownDepartments(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(inArray(departments.id, [...new Set(ids)]));
  return new Set(rows.map((row) => row.id));
}
