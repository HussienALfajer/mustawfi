import { type Device, deviceRevokedAt, userAccess } from "@mustawfi/core-access/server";
import { accessGrant } from "@mustawfi/core-access/shared";
import { ProblemError } from "@mustawfi/core-config/server";
import type { TenantDatabase, TenantTransaction } from "@mustawfi/core-tenancy/server";
import { eq, max, sql } from "drizzle-orm";
import {
  syncProblemCodes,
  type OperationResult,
  type PushResponse,
  type SyncOperation,
  type SyncValues,
} from "../shared/index.ts";
import {
  OperationRejected,
  type ReceivedOperation,
  type SyncHandlerDependencies,
  type SyncOperationTable,
} from "./operations.ts";
import { flagOperation } from "./flags.ts";
import { receivedOps } from "./schema.ts";

export interface PushDependencies extends SyncHandlerDependencies {
  readonly operations: SyncOperationTable;
}

/** What processing one operation came to, and whether its device was revoked by then. */
type Outcome =
  | {
      readonly kind: "done";
      readonly result: OperationResult;
      readonly next: number;
      readonly revoked: boolean;
    }
  | { readonly kind: "gap"; readonly next: number; readonly revoked: boolean };

/**
 * Receives a device's pushed operations (ADR-0020): in `deviceSeq` order, each in its own
 * transaction, idempotent by `opId`. Processing stops at the first gap in `deviceSeq`, and the
 * answer names the number the device resends from. A push carrying another device's operation
 * is refused whole.
 *
 * A revoked device still pushes (`core-foundation` rule 23, ADR-0030): every operation it gets
 * accepted is flagged `deviceRevoked`, and the answer says `revoked`, so the device wipes its
 * data once every operation has an answer.
 */
export async function pushOperations(
  tenants: TenantDatabase,
  device: Device,
  operations: readonly SyncOperation[],
  dependencies: PushDependencies,
): Promise<PushResponse> {
  if (operations.some((op) => op.deviceId !== device.deviceId)) {
    throw new ProblemError(syncProblemCodes.wrongDevice, 422, {
      title: "A device pushes only its own operations",
    });
  }
  const ordered = [...operations].sort((a, b) => a.deviceSeq - b.deviceSeq);
  const results: OperationResult[] = [];
  let next = 1;
  let revoked = device.revokedAt !== null;
  for (const operation of ordered) {
    const outcome = await receiveOperation(tenants, device, operation, dependencies);
    next = outcome.next;
    revoked ||= outcome.revoked;
    if (outcome.kind === "gap") return { results, nextDeviceSeq: next, gap: true, revoked };
    results.push(outcome.result);
  }
  return { results, nextDeviceSeq: next, gap: false, revoked };
}

/**
 * One operation: handled and stored in one transaction, or — when the handler rejects it —
 * rolled back and stored as rejected in a second one. Both run under the device's lock and
 * check `opId` and `deviceSeq` afresh, so a concurrent push of the same operation cannot record
 * it twice.
 */
async function receiveOperation(
  tenants: TenantDatabase,
  device: Device,
  operation: SyncOperation,
  dependencies: PushDependencies,
): Promise<Outcome> {
  const context = {
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    userId: operation.userId,
  };
  const received: ReceivedOperation = {
    opId: operation.opId,
    deviceSeq: operation.deviceSeq,
    type: operation.type,
    payloadVersion: operation.payloadVersion,
    payload: operation.payload,
    tenantId: device.tenantId,
    branchId: device.branchId,
    device: { id: device.deviceId, prefix: device.prefix },
    userId: operation.userId,
    shiftId: operation.shiftId,
    createdAt: new Date(operation.createdAt),
    receivedAt: dependencies.clock.now(),
  };
  try {
    return await tenants.withTenant(context, (tx) =>
      processOperation(tx, received, null, dependencies),
    );
  } catch (error) {
    if (!(error instanceof OperationRejected)) throw error;
    return tenants.withTenant(context, (tx) => processOperation(tx, received, error, dependencies));
  }
}

async function processOperation(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  rejection: OperationRejected | null,
  dependencies: PushDependencies,
): Promise<Outcome> {
  // One operation of a device at a time, so `opId` and `deviceSeq` are checked race-free.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`core_sync.device:${operation.device.id}`}, 0))`,
  );
  const base = { opId: operation.opId, deviceSeq: operation.deviceSeq };
  const [stored] = await tx
    .select({
      status: receivedOps.status,
      result: receivedOps.result,
      problemCode: receivedOps.problemCode,
      problemDetail: receivedOps.problemDetail,
    })
    .from(receivedOps)
    .where(eq(receivedOps.id, operation.opId));
  const [last] = await tx
    .select({ seq: max(receivedOps.deviceSeq) })
    .from(receivedOps)
    .where(eq(receivedOps.deviceId, operation.device.id));
  const expected = (last?.seq ?? 0) + 1;
  // Read under the device's lock, in this operation's transaction: a revoke that committed
  // before it flags it, whenever its push began.
  const revokedAt = await deviceRevokedAt(tx, operation.device.id);
  const revoked = revokedAt !== null;

  if (stored !== undefined) {
    // `received_ops_outcome` guarantees a result for an accepted row and a code for a rejected one.
    if (stored.status === "accepted" ? stored.result === null : stored.problemCode === null) {
      throw new Error(`received operation ${operation.opId} has no stored outcome`);
    }
    const result: OperationResult =
      stored.status === "accepted"
        ? { ...base, status: "duplicate", result: stored.result ?? {} }
        : {
            ...base,
            status: "rejected",
            code: stored.problemCode ?? "",
            ...(stored.problemDetail === null ? {} : { detail: stored.problemDetail }),
          };
    return { kind: "done", result, next: expected, revoked };
  }
  if (base.deviceSeq > expected) return { kind: "gap", next: expected, revoked };
  if (base.deviceSeq < expected) {
    const result: OperationResult = {
      ...base,
      status: "rejected",
      code: syncProblemCodes.seqTaken,
      detail: `deviceSeq ${String(base.deviceSeq)} belongs to another operation`,
    };
    return { kind: "done", result, next: expected, revoked };
  }

  if (rejection !== null) {
    await store(tx, operation, {
      status: "rejected",
      problemCode: rejection.code,
      problemDetail: rejection.detail ?? null,
    });
    const result: OperationResult = {
      ...base,
      status: "rejected",
      code: rejection.code,
      ...(rejection.detail === undefined ? {} : { detail: rejection.detail }),
    };
    return { kind: "done", result, next: expected + 1, revoked };
  }

  const definition = dependencies.operations.get(operation.type);
  if (definition === undefined) {
    throw new OperationRejected(
      syncProblemCodes.unsupportedType,
      `this server does not handle ${operation.type}`,
    );
  }
  const handler = definition.versions[operation.payloadVersion];
  if (handler === undefined) {
    throw new OperationRejected(
      syncProblemCodes.unsupportedVersion,
      `${operation.type} has no payload version ${String(operation.payloadVersion)} here`,
    );
  }
  const user = await userAccess(tx, operation.userId, dependencies.operations.permissionCatalogue);
  if (user === undefined) throw new OperationRejected(syncProblemCodes.unknownUser);
  const { access } = definition;
  if (access !== "device") {
    // Checked with the user's role at ingest; a miss is recorded, not refused (rule 17).
    const departmentId = access.department?.(operation.payload);
    const grant = accessGrant(dependencies.operations.permissionCatalogue, user.access);
    const scoped =
      dependencies.operations.permissionCatalogue.permissions.get(access.permission)?.scoped ===
      true;
    // A scoped operation that names no department cannot be shown to be allowed: flagged (the
    // handler usually rejects such a payload, which rolls the flag back with it).
    const allowed =
      scoped && departmentId === undefined ? false : grant.can(access.permission, departmentId);
    if (!allowed) {
      await flagOperation(
        tx,
        operation,
        {
          code: "permissionMissing",
          detail: {
            permission: access.permission,
            ...(departmentId === undefined ? {} : { departmentId }),
            roleId: user.role.id,
          },
        },
        dependencies,
      );
    }
  }
  if (revokedAt !== null) {
    // Accepted all the same: a sale made before the device heard is a real sale (ADR-0030).
    await flagOperation(
      tx,
      operation,
      { code: "deviceRevoked", detail: { revokedAt: revokedAt.toISOString() } },
      dependencies,
    );
  }
  const result: SyncValues = await handler(tx, operation, dependencies);
  await store(tx, operation, { status: "accepted", result });
  return {
    kind: "done",
    result: { ...base, status: "accepted", result },
    next: expected + 1,
    revoked,
  };
}

async function store(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  outcome:
    | { readonly status: "accepted"; readonly result: SyncValues }
    | {
        readonly status: "rejected";
        readonly problemCode: string;
        readonly problemDetail: string | null;
      },
): Promise<void> {
  await tx.insert(receivedOps).values({
    id: operation.opId,
    tenantId: operation.tenantId,
    branchId: operation.branchId,
    createdAt: operation.receivedAt,
    createdBy: operation.userId,
    deviceId: operation.device.id,
    deviceSeq: operation.deviceSeq,
    type: operation.type,
    payloadVersion: operation.payloadVersion,
    shiftId: operation.shiftId,
    deviceCreatedAt: operation.createdAt,
    payload: { ...operation.payload },
    ...outcome,
  });
}
