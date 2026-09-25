import { z } from "zod";

/** What happened, as `module.subject.event` in dotted camelCase (`access.login.succeeded`). */
export const auditActionSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, "an audit action is dotted camelCase");

/** A snapshot of values before or after a change: plain JSON, never a secret. */
export type AuditValues = { readonly [key: string]: AuditValue };
export type AuditValue =
  string | number | boolean | null | readonly AuditValue[] | { readonly [key: string]: AuditValue };
