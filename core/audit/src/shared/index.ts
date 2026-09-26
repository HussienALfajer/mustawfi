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

/** The most entries one page of the log holds, and how many a page holds when not asked. */
export const AUDIT_PAGE_LIMIT = 100;
export const AUDIT_PAGE_DEFAULT = 50;

/**
 * `GET /api/v1/audit/entries` (flow 10): the filters, all optional and combined. `from` and `to`
 * are business dates in the store's time zone, both included, on the time of the event.
 * `after` is the id of the last entry of the previous page (keyset paging, newest first).
 */
export const auditQuerySchema = z
  .object({
    user: z.uuid().optional(),
    action: auditActionSchema.optional(),
    device: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_LIMIT).default(AUDIT_PAGE_DEFAULT),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "from is after to",
    path: ["to"],
  });

export type AuditQuery = z.input<typeof auditQuerySchema>;

const auditValuesSchema = z.record(z.string(), z.unknown());

/** A user as the log names them: deactivated users keep their name here. */
export const auditUserSchema = z.object({ id: z.uuid(), name: z.string() });

/** A device as the log names it: revoked devices keep their name and prefix here. */
export const auditDeviceSchema = z.object({ id: z.uuid(), name: z.string(), prefix: z.string() });

export type AuditUser = z.infer<typeof auditUserSchema>;
export type AuditDevice = z.infer<typeof auditDeviceSchema>;

/**
 * One entry as the audit log screen reads it: who (null when no known user acted), which
 * device, what, on which record, before and after, and why. `occurredAt` is the time of the
 * event — the device's clock for a device event — and `recordedAt` when the server recorded it.
 */
export const auditEntryViewSchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  source: z.enum(["server", "device"]),
  user: auditUserSchema.nullable(),
  device: auditDeviceSchema.nullable(),
  action: z.string(),
  entity: z.object({ type: z.string(), id: z.uuid() }).nullable(),
  before: auditValuesSchema.nullable(),
  after: auditValuesSchema.nullable(),
  reason: z.string().nullable(),
});

export type AuditEntryView = z.infer<typeof auditEntryViewSchema>;

/** A page of the log, newest first; `next` is the `after` of the following page, if any. */
export const auditPageSchema = z.object({
  items: z.array(auditEntryViewSchema),
  next: z.uuid().nullable(),
});

export type AuditPage = z.infer<typeof auditPageSchema>;

/**
 * `GET /api/v1/audit/facets`: what the filters offer — every user and device of the store,
 * deactivated and revoked ones included, and the actions the log holds.
 */
export const auditFacetsSchema = z.object({
  users: z.array(auditUserSchema),
  devices: z.array(auditDeviceSchema),
  actions: z.array(z.string()),
});

export type AuditFacets = z.infer<typeof auditFacetsSchema>;
