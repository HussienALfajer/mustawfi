/**
 * The events a device audits about its license and its clock (`core-foundation` rules 7–9 and
 * the audited events), through the device audit path (rule 33): each is recorded once when its
 * condition begins, by the reading that notices it, and again only after the condition ended.
 * The server accepts these actions from devices (`TENANCY_DEVICE_AUDIT_ACTIONS`).
 */
export const DEVICE_LICENSE_EVENTS = {
  /** The day's state became read-only on the device (rule 6). */
  readOnly: { action: "tenancy.license.readOnlyReached" },
  /** The day's state became suspended on the device. */
  suspended: { action: "tenancy.license.suspendedReached" },
  /** No server contact for more than the license's maximum offline days (rule 7). */
  offlineTooLong: { action: "tenancy.license.offlineTooLong" },
  /** The local clock was found more than the tolerance behind the high-water mark (rule 8). */
  clockBehind: { action: "tenancy.clock.movedBack" },
  /** The local clock was more than the skew limit from the server's at a server time (rule 8). */
  clockWrong: { action: "tenancy.clock.wrong" },
} as const;

export type DeviceLicenseCondition = keyof typeof DEVICE_LICENSE_EVENTS;

/** The device audit actions of `core.tenancy`, which the server accepts from its devices. */
export const TENANCY_DEVICE_AUDIT_ACTIONS: readonly string[] = Object.values(
  DEVICE_LICENSE_EVENTS,
).map((event) => event.action);
