import { OVERRIDE_DEVICE_EVENTS } from "./override.ts";

/** Wrong PINs in a row that lock a user on a device (`core-foundation` rule 20). */
export const PIN_ATTEMPTS = 5;

/**
 * Time without input after which a device returns to the PIN screen (rule 24). Fixed here; a
 * setting in `core-config`.
 */
export const IDLE_LOCK_MS = 5 * 60_000;

/** The permission that lets a supervisor unlock a user locked out on a device (rule 20). */
export const UNLOCK_PERMISSION = "access.users.unlock";

/**
 * The events a device audits about PIN sign-in without the server (rules 20 and 33), through the
 * device audit path. PIN sign-in that reaches the server is audited there (`access.login.*`).
 * The server accepts these actions from devices (`ACCESS_DEVICE_AUDIT_ACTIONS`).
 */
export const PIN_DEVICE_EVENTS = {
  /** A user signed in by PIN, verified on the device against the bundle. */
  signedIn: { action: "access.pin.signedIn" },
  /** A wrong PIN, checked on the device. */
  failed: { action: "access.pin.failed" },
  /** The wrong PIN that locked the user on the device. */
  lockedOut: { action: "access.pin.lockedOut" },
  /** A supervisor unlocked a locked-out user on the device. */
  unlocked: { action: "access.pin.unlocked" },
} as const;

/**
 * The device audit actions of `core.access` — PIN sign-in and supervisor overrides — which the
 * server accepts from its devices.
 */
export const ACCESS_DEVICE_AUDIT_ACTIONS: readonly string[] = [
  ...Object.values(PIN_DEVICE_EVENTS),
  ...Object.values(OVERRIDE_DEVICE_EVENTS),
].map((event) => event.action);
