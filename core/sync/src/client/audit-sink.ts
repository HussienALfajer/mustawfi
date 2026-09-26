import { localDevice } from "@mustawfi/core-access/client";
import type { AuditSink } from "@mustawfi/core-config/client";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { DEVICE_AUDIT_OPERATION, type SyncValues } from "../shared/index.ts";
import { enqueueOperation } from "./outbox.ts";

export interface OutboxAuditSinkOptions {
  /** The device's clock: the event's time, as the server records it (`created_at`). */
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** The shift the device's operations carry. */
  readonly shiftId: string;
}

/**
 * The device audit path (`core-foundation` rule 33): an `AuditSink` that queues each event as an
 * `audit.entry.record` operation in the outbox, in the caller's transaction, so it reaches the
 * server with the next push and is recorded there once. Refuses on a client that is not a
 * registered device.
 */
export function outboxAuditSink(options: OutboxAuditSinkOptions): AuditSink {
  return {
    async record(tx, event) {
      const device = await localDevice(tx);
      if (device === undefined) {
        throw new Error(`${event.action} was audited on a client that is not a registered device`);
      }
      // `deviceAuditPayloadSchema`, version 1.
      const payload: SyncValues = {
        action: event.action,
        ...(event.entity === undefined ? {} : { entity: { ...event.entity } }),
        ...(event.before === undefined ? {} : { before: event.before }),
        ...(event.after === undefined ? {} : { after: event.after }),
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
      await enqueueOperation(tx, {
        opId: options.newId(),
        deviceId: device.deviceId,
        type: DEVICE_AUDIT_OPERATION,
        payloadVersion: 1,
        payload,
        userId: event.userId,
        shiftId: options.shiftId,
        createdAt: options.clock.now(),
      });
    },
  };
}
