import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import { asc, gt, sql } from "drizzle-orm";
import {
  operationTypeSchema,
  PULL_PAGE_LIMIT,
  type PullResponse,
  type SyncValues,
} from "../shared/index.ts";
import { changes, tenantCounters } from "./schema.ts";

export interface ChangeInput {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  /** `inventory.product`… */
  readonly entity: string;
  readonly entityId: string;
  /** The entity's full row after the change, as devices store it; `null` for a tombstone. */
  readonly row: SyncValues | null;
}

/**
 * Appends a change of data that flows down to the tenant's change log, in `tx` — the
 * transaction that writes the change, so both commit or neither does (ADR-0020). The number
 * comes from the tenant's counter row, which stays locked until `tx` ends: change-log writes
 * are serialized per tenant, so a device that has seen number `n` never later misses a lower
 * one. Returns the change's number.
 */
export async function recordChange(
  tx: TenantTransaction,
  change: ChangeInput,
  dependencies: { readonly newId: IdGenerator },
): Promise<number> {
  const entity = operationTypeSchema.parse(change.entity);
  const audit = {
    tenantId: change.tenantId,
    branchId: change.branchId,
    createdAt: change.createdAt,
    createdBy: change.createdBy,
  };
  const [counter] = await tx
    .insert(tenantCounters)
    .values({ ...audit, id: dependencies.newId(), changeSeq: 1 })
    .onConflictDoUpdate({
      target: tenantCounters.tenantId,
      set: { changeSeq: sql`${sql.identifier("tenant_counters")}.change_seq + 1` },
    })
    .returning({ seq: tenantCounters.changeSeq });
  if (counter === undefined) throw new Error("the change counter returned no row");
  await tx.insert(changes).values({
    ...audit,
    id: dependencies.newId(),
    seq: counter.seq,
    entity,
    entityId: change.entityId,
    row: change.row,
  });
  return counter.seq;
}

/**
 * A page of the current tenant's changes after `cursor`, in commit order. The cursor is the
 * number of the last change the device applied (`"0"` before the first).
 */
export async function readChanges(
  tx: TenantTransaction,
  page: { readonly cursor: string; readonly limit?: number },
): Promise<PullResponse> {
  const limit = page.limit ?? PULL_PAGE_LIMIT;
  const rows = await tx
    .select({ seq: changes.seq, entity: changes.entity, id: changes.entityId, row: changes.row })
    .from(changes)
    .where(gt(changes.seq, Number.parseInt(page.cursor, 10)))
    .orderBy(asc(changes.seq))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    changes: pageRows.map(({ entity, id, row }) => ({ entity, id, row })),
    cursor: last === undefined ? page.cursor : String(last.seq),
    more: rows.length > limit,
  };
}
