import { z } from "zod";

/** What happened, as `module.subject.event` in dotted camelCase (`access.login.succeeded`). */
export const auditActionSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, "an audit action is dotted camelCase");

/**
 * Where an audited event happened: on the `server`, or on a `device`, which queued it in its
 * outbox and pushed it later (`core-foundation` rule 33: its time is the device's).
 */
export type AuditSource = "server" | "device";

/** A snapshot of values before or after a change: plain JSON, never a secret. */
export type AuditValues = { readonly [key: string]: AuditValue };
export type AuditValue =
  string | number | boolean | null | readonly AuditValue[] | { readonly [key: string]: AuditValue };
