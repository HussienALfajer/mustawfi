import { type AuditEntry, recordAudit } from "@mustawfi/core-audit/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";

/** Who changes roles or users, where, and when. */
export interface RoleActor {
  /** Must be the tenant of the `withTenant` context the change runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  readonly deviceId?: string;
  readonly at: Date;
}

/** A signed-in user managing users and roles: whether they are an owner decides rule 14. */
export interface Manager extends RoleActor {
  readonly isOwner: boolean;
}

/** Appends an audit entry of `actor`'s change in `tx`. */
export async function auditAs(
  tx: TenantTransaction,
  actor: RoleActor,
  dependencies: { readonly newId: IdGenerator },
  entry: Pick<AuditEntry, "action" | "entity" | "before" | "after" | "reason">,
): Promise<void> {
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    ...entry,
  });
}

/** Whether `error` is a unique violation of `constraint`, through the driver's wrapping. */
export function violates(error: unknown, constraint: string): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    const fields = e as { code?: unknown; constraint?: unknown };
    if (fields.code === "23505") return fields.constraint === constraint;
  }
  return false;
}
