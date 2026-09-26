import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import {
  accessGrant,
  grantCovers,
  overrideRequestOf,
  type SupervisorOverride,
} from "../shared/index.ts";
import { userAccess } from "./users.ts";

/**
 * An override the approver's role does not cover, as the accountant's flag describes it (a type,
 * not an interface, so it is a JSON value the flag's detail can hold).
 */
export type RefusedOverride = {
  readonly overrideId: string;
  readonly approverId: string;
  readonly permission: string;
  readonly departmentId?: string;
  readonly limit?: { readonly id: string; readonly value: string };
  /** `unknownApprover`: no user of the tenant has this id. */
  readonly reason: "unknownApprover" | "notCovered";
  /** The approver's role at the check. */
  readonly roleId?: string;
};

export interface CheckedOverrides {
  readonly covered: readonly SupervisorOverride[];
  readonly refused: readonly RefusedOverride[];
}

/**
 * Checks each supervisor override a document carries against its approver's role as it is now
 * (`core-foundation` rule 18): the permission, in the department, and the value within the
 * limit — what the device checked when it granted it. The server re-checks at ingest, as it
 * checks the seller's own permission (rule 17): a role changed since the override is judged as
 * it is now. An approver deactivated since still has a role and is judged by it, like a seller.
 */
export async function checkOverrides(
  tx: TenantTransaction,
  catalogue: PermissionCatalogue,
  overrides: readonly SupervisorOverride[],
): Promise<CheckedOverrides> {
  const covered: SupervisorOverride[] = [];
  const refused: RefusedOverride[] = [];
  for (const override of overrides) {
    const described = {
      overrideId: override.id,
      approverId: override.approverId,
      permission: override.permission,
      ...(override.departmentId === undefined ? {} : { departmentId: override.departmentId }),
      ...(override.limit === undefined ? {} : { limit: override.limit }),
    };
    const approver = await userAccess(tx, override.approverId, catalogue);
    if (approver === undefined) {
      refused.push({ ...described, reason: "unknownApprover" });
      continue;
    }
    const grant = accessGrant(catalogue, approver.access);
    if (grantCovers(catalogue, grant, overrideRequestOf(override))) covered.push(override);
    else refused.push({ ...described, reason: "notCovered", roleId: approver.role.id });
  }
  return { covered, refused };
}
