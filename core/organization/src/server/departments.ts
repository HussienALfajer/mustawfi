import { namedLastChanges, usersListingDepartment } from "@mustawfi/core-access/server";
import { recordAudit } from "@mustawfi/core-audit/server";
import type { AuditValues } from "@mustawfi/core-audit/shared";
import { recordChange } from "@mustawfi/core-sync/server";
import {
  archiveDepartment,
  createDepartment,
  listDepartments,
  type TenantTransaction,
  renameDepartment,
  restoreDepartment,
} from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import {
  DEPARTMENT_ENTITY,
  type DepartmentListItem,
  type DepartmentView,
} from "../shared/index.ts";

/** Who changes the organization, where, and when: what every audit entry and change carries. */
export interface Actor {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  readonly deviceId?: string;
  readonly at: Date;
}

export interface OrganizationDependencies {
  readonly newId: IdGenerator;
}

/** The audit action of each department change, written out whole for the audit catalogue. */
const DEPARTMENT_AUDIT = {
  created: { action: "organization.department.created" },
  renamed: { action: "organization.department.renamed" },
  archived: { action: "organization.department.archived" },
  restored: { action: "organization.department.restored" },
} as const;

type DepartmentAction = keyof typeof DEPARTMENT_AUDIT;

/** The actions that change a department, for its «last changed by … on …». */
const DEPARTMENT_CHANGES = Object.values(DEPARTMENT_AUDIT).map((entry) => entry.action);

/**
 * Audits a department change and appends it to the change log devices pull from. `extra` adds
 * facts to the audit entry's `after` that the change log does not carry.
 */
export async function publishDepartment(
  tx: TenantTransaction,
  actor: Actor,
  action: DepartmentAction,
  change: { readonly before?: DepartmentView; readonly after: DepartmentView },
  dependencies: OrganizationDependencies,
  extra: AuditValues = {},
): Promise<void> {
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    action: DEPARTMENT_AUDIT[action].action,
    entity: { type: DEPARTMENT_ENTITY, id: change.after.id },
    ...(change.before === undefined ? {} : { before: change.before }),
    after: { ...change.after, ...extra },
  });
  await recordChange(
    tx,
    {
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: actor.at,
      createdBy: actor.userId,
      entity: DEPARTMENT_ENTITY,
      entityId: change.after.id,
      // Archived departments stay on devices with their `archivedAt`: documents keep naming them.
      row: change.after,
    },
    dependencies,
  );
}

/** Adds a department (within the license's limit), audited and published, in `tx`. */
export async function addDepartment(
  tx: TenantTransaction,
  actor: Actor,
  name: string,
  dependencies: OrganizationDependencies,
): Promise<DepartmentView> {
  const after = await createDepartment(tx, {
    id: dependencies.newId(),
    name,
    createdAt: actor.at,
    createdBy: actor.userId,
  });
  await publishDepartment(tx, actor, "created", { after }, dependencies);
  return after;
}

/** Renames an active department, audited with before and after and published, in `tx`. */
export async function changeDepartmentName(
  tx: TenantTransaction,
  actor: Actor,
  change: { readonly id: string; readonly name: string },
  dependencies: OrganizationDependencies,
): Promise<DepartmentView> {
  const changed = await renameDepartment(tx, change);
  await publishDepartment(tx, actor, "renamed", changed, dependencies);
  return changed.after;
}

/** Archives a department (not the default, not the last active), audited and published. */
export async function retireDepartment(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  dependencies: OrganizationDependencies,
): Promise<DepartmentView> {
  const changed = await archiveDepartment(tx, {
    id,
    archivedAt: actor.at,
    archivedBy: actor.userId,
  });
  await publishDepartment(tx, actor, "archived", changed, dependencies);
  return changed.after;
}

/**
 * Restores an archived department (`core-foundation` slice 20) within the license's limit,
 * audited `organization.department.restored` — with the users whose listed scope names it again
 * (`usersInScope`), since restoring gives it back to them — and published. No confirmation:
 * nothing is lost either way.
 */
export async function reinstateDepartment(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  dependencies: OrganizationDependencies,
): Promise<DepartmentView> {
  const changed = await restoreDepartment(tx, { id });
  const usersInScope = await usersListingDepartment(tx, id);
  await publishDepartment(tx, actor, "restored", changed, dependencies, { usersInScope });
  return changed.after;
}

/** The tenant's departments, archived ones included, each with its last change. */
export async function listDepartmentItems(tx: TenantTransaction): Promise<DepartmentListItem[]> {
  const items = await listDepartments(tx);
  const changes = await namedLastChanges(
    tx,
    DEPARTMENT_ENTITY,
    items.map((item) => item.id),
    DEPARTMENT_CHANGES,
  );
  return items.map((item) => ({ ...item, lastChange: changes.get(item.id) ?? null }));
}
