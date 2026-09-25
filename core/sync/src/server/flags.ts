import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import {
  type OperationFlagCode,
  operationFlagCodeSchema,
  type SyncValues,
} from "../shared/index.ts";
import type { ReceivedOperation } from "./operations.ts";
import { operationFlags } from "./schema.ts";

export interface OperationFlag {
  readonly code: OperationFlagCode;
  /** What was found, kept as a snapshot. */
  readonly detail: SyncValues;
}

/**
 * Flags `operation` for the accountant (ADR-0030) in `tx`, the operation's own transaction, so
 * the flag commits with the document or not at all. Any module handling or inspecting an
 * operation may flag it. A code is kept once per operation: flagging it again keeps the first
 * flag and its detail, rather than failing the operation.
 */
export async function flagOperation(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  flag: OperationFlag,
  dependencies: { readonly newId: IdGenerator },
): Promise<void> {
  await tx
    .insert(operationFlags)
    .values({
      id: dependencies.newId(),
      tenantId: operation.tenantId,
      branchId: operation.branchId,
      createdAt: operation.receivedAt,
      createdBy: operation.userId,
      opId: operation.opId,
      code: operationFlagCodeSchema.parse(flag.code),
      detail: flag.detail,
    })
    .onConflictDoNothing({
      target: [operationFlags.tenantId, operationFlags.opId, operationFlags.code],
    });
}
