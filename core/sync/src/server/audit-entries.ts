import { recordAudit } from "@mustawfi/core-audit/server";
import {
  DEVICE_AUDIT_OPERATION,
  deviceAuditPayloadSchema,
  syncProblemCodes,
} from "../shared/index.ts";
import { OperationRejected, type SyncOperationDefinition } from "./operations.ts";

/**
 * `audit.entry.record` (`core-foundation` rule 33, the device audit path): an event audited on a
 * device — the clock moved back, a license state reached, later PIN lockouts and overrides —
 * queued in its outbox in the transaction that noticed it, and recorded here with the device's
 * time as `created_at`, the receipt as `recorded_at`, and `source = device`. Push stores the
 * operation in the same transaction, keyed by its `opId`, so a resend is answered as a duplicate
 * and the entry is recorded once.
 *
 * Only the actions in `actions` are accepted — the device events the enabled modules declare —
 * so a device credential cannot write any other entry into the log. Any user of a registered
 * device may send one (`device` access): who acted is the operation's user.
 */
export function deviceAuditOperation(actions: ReadonlySet<string>): SyncOperationDefinition {
  return {
    type: DEVICE_AUDIT_OPERATION,
    access: "device",
    versions: {
      1: async (tx, operation, dependencies) => {
        const parsed = deviceAuditPayloadSchema.safeParse(operation.payload);
        if (!parsed.success) {
          throw new OperationRejected(syncProblemCodes.auditEntryMalformed, parsed.error.message);
        }
        const event = parsed.data;
        if (!actions.has(event.action)) {
          throw new OperationRejected(
            syncProblemCodes.auditEntryUnknownAction,
            `${event.action} is not a device event of this server's modules`,
          );
        }
        const id = dependencies.newId();
        await recordAudit(tx, {
          id,
          tenantId: operation.tenantId,
          branchId: operation.branchId,
          occurredAt: operation.createdAt,
          receivedAt: operation.receivedAt,
          userId: operation.userId,
          deviceId: operation.device.id,
          action: event.action,
          ...(event.entity === undefined ? {} : { entity: event.entity }),
          ...(event.before === undefined ? {} : { before: event.before }),
          ...(event.after === undefined ? {} : { after: event.after }),
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        });
        return { entryId: id };
      },
    },
  };
}
