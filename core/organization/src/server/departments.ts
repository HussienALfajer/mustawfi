import { recordAudit } from "@mustawfi/core-audit/server";
import { recordChange } from "@mustawfi/core-sync/server";
import {
  archiveDepartment,
  createDepartment,
  type TenantTransaction,
  renameDepartment,
} from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import { DEPARTMENT_ENTITY, type DepartmentView } from "../shared/index.ts";

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

type DepartmentAction = "created" | "renamed" | "archived";

/** Audits a department change and appends it to the change log devices pull from. */
export async function publishDepartment(
  tx: TenantTransaction,
  actor: Actor,
  action: DepartmentAction,
  change: { readonly before?: DepartmentView; readonly after: DepartmentView },
  dependencies: OrganizationDependencies,
): Promise<void> {
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    action: `organization.department.${action}`,
    entity: { type: DEPARTMENT_ENTITY, id: change.after.id },
    ...(change.before === undefined ? {} : { before: change.before }),
    after: change.after,
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
