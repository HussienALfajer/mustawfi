import type { LocalExecutor } from "@mustawfi/local-db";

/** Plain JSON, as the audit log keeps values: never a secret. */
export type DeviceAuditValue =
  | string
  | number
  | boolean
  | null
  | readonly DeviceAuditValue[]
  | { readonly [key: string]: DeviceAuditValue };

export type DeviceAuditValues = { readonly [key: string]: DeviceAuditValue };

/**
 * An event audited on this device (non-negotiable 10, `core-foundation` rule 33): who acted and
 * what happened. The sink adds the device and the device's time; the server adds when it
 * received it.
 */
export interface DeviceAuditEvent {
  /**
   * `module.subject.event`, one the module declares as a device event, so the server accepts it
   * (`audit.entry.record`).
   */
  readonly action: string;
  /** The user signed in on the device, whose session noticed or did it. */
  readonly userId: string;
  readonly entity?: { readonly type: string; readonly id: string };
  readonly before?: DeviceAuditValues;
  readonly after?: DeviceAuditValues;
  readonly reason?: string;
}

/**
 * Where a module's client code audits an event that happens on the device (the device audit
 * path). The app wires it to the sync outbox, so a module audits without depending on
 * `core.sync`. `record` writes in `tx`, the caller's local transaction: the event commits with
 * the change it records, or not at all. It throws on a client that is not a registered device,
 * which has no outbox to send it through.
 */
export interface AuditSink {
  record(tx: LocalExecutor, event: DeviceAuditEvent): Promise<void>;
}
