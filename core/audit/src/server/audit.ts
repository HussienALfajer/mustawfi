import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { auditActionSchema, type AuditValues } from "../shared/index.ts";
import { entries } from "./schema.ts";

/** One audited event (non-negotiable 10): who, what, when, which device, before and after. */
export interface AuditEntry {
  readonly id: string;
  /** Must be the tenant of the `withTenant` context the entry is written in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  /** Who acted; `null` only when no known user did (a sign-in naming an unknown login). */
  readonly userId: string | null;
  readonly deviceId?: string;
  readonly action: string;
  readonly entity?: { readonly type: string; readonly id: string };
  readonly before?: AuditValues;
  readonly after?: AuditValues;
  /** Why, as the person who acted typed it, when the action asks for one. */
  readonly reason?: string;
}

/**
 * Appends `entry` to the tenant's audit log in `tx`, so it commits or rolls back with the
 * change it records. The log is append-only: nothing can change or remove an entry.
 */
export async function recordAudit(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
  await tx.insert(entries).values({
    id: entry.id,
    tenantId: entry.tenantId,
    branchId: entry.branchId,
    createdAt: entry.occurredAt,
    createdBy: entry.userId,
    deviceId: entry.deviceId ?? null,
    action: auditActionSchema.parse(entry.action),
    entityType: entry.entity?.type ?? null,
    entityId: entry.entity?.id ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
