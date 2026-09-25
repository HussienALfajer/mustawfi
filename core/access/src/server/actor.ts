import { type AuditEntry, recordAudit } from "@mustawfi/core-audit/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { Decimal, type IdGenerator } from "@mustawfi/kernel";
import { accessProblemCodes, type RoleHoldings } from "../shared/index.ts";

/** Who changes roles or users, where, and when. */
export interface RoleActor {
  /** Must be the tenant of the `withTenant` context the change runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  readonly deviceId?: string;
  readonly at: Date;
}

/**
 * A signed-in user managing users and roles: whether they are an owner decides rule 14, and
 * what a non-owner holds bounds what they may grant (`checkGrantable`).
 */
export interface Manager extends RoleActor {
  readonly isOwner: boolean;
  /** The permissions the manager holds; ignored for an owner. */
  readonly permissions: readonly string[];
  /** The manager's limit values by limit id; a missing one is zero. Ignored for an owner. */
  readonly limits: Readonly<Record<string, string>>;
}

const NOTHING: RoleHoldings = { permissions: [], limits: {} };

/**
 * A non-owner grants nothing they do not hold (`core-foundation` slice 6, user decision
 * 2026-09-26): every permission `holdings` adds to `before` must be one `manager` holds, and
 * every limit value it raises may not exceed the manager's own. Checked when a role is copied
 * or edited (`before` is the role as it was) and when a user is given a role (`before` is
 * nothing). A 403 `access.role.beyondOwnGrant` names what is out of reach.
 */
export function checkGrantable(
  manager: Manager,
  holdings: RoleHoldings,
  before: RoleHoldings = NOTHING,
): void {
  if (manager.isOwner) return;
  const held = new Set(manager.permissions);
  const permissions = holdings.permissions.filter(
    (permission) => !before.permissions.includes(permission) && !held.has(permission),
  );
  const limits = Object.entries(holdings.limits)
    .filter(([limit, value]) => {
      const prior = before.limits[limit];
      if (prior !== undefined && !Decimal.of(value).greaterThan(Decimal.of(prior))) return false;
      return Decimal.of(value).greaterThan(Decimal.of(manager.limits[limit] ?? "0"));
    })
    .map(([limit]) => limit);
  if (permissions.length > 0 || limits.length > 0) {
    throw new ProblemError(accessProblemCodes.beyondOwnGrant, 403, {
      title: "You cannot grant what your own role does not hold",
      detail: [...permissions, ...limits].join(", "),
    });
  }
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
