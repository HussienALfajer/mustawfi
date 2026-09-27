import { type TenantTransaction } from "@mustawfi/core-tenancy/server";
import { BUSINESS_TIME_ZONE } from "@mustawfi/core-tenancy/shared";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
  AUDIT_PAGE_DEFAULT,
  type AuditDevice,
  type AuditEntryView,
  type AuditPage,
  type AuditUser,
} from "../shared/index.ts";
import { entries } from "./schema.ts";

/**
 * Who the log names, from `core.access` (which depends on this module, so the host hands it
 * over): every user and device of the tenant, deactivated and revoked ones included, read in the
 * reader's transaction.
 */
export interface AuditDirectory {
  users(tx: TenantTransaction): Promise<readonly AuditUser[]>;
  devices(tx: TenantTransaction): Promise<readonly AuditDevice[]>;
}

/** The filters of one page (`auditQuerySchema`, parsed). */
export interface AuditFilters {
  readonly user?: string | undefined;
  readonly action?: string | undefined;
  readonly device?: string | undefined;
  /** The record whose entries are listed. */
  readonly entity?: string | undefined;
  /** First business date included, `YYYY-MM-DD`, in the store's time zone. */
  readonly from?: string | undefined;
  /** Last business date included. */
  readonly to?: string | undefined;
  /** The id of the last entry of the previous page. */
  readonly after?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * One page of the tenant's audit log (flow 10, `core-foundation` rule 35), newest event first,
 * with users and devices named. Paging is by keyset on (time of the event, id): the page after
 * an entry holds the entries strictly older than it, so entries recorded meanwhile — a device
 * pushing events from its past included — never shift a page or repeat one. An `after` naming no
 * entry of this tenant gives an empty page.
 */
export async function listAuditEntries(
  tx: TenantTransaction,
  filters: AuditFilters,
  directory: AuditDirectory,
): Promise<AuditPage> {
  const limit = filters.limit ?? AUDIT_PAGE_DEFAULT;
  const conditions: SQL[] = [];
  if (filters.user !== undefined) conditions.push(eq(entries.createdBy, filters.user));
  if (filters.action !== undefined) conditions.push(eq(entries.action, filters.action));
  if (filters.device !== undefined) conditions.push(eq(entries.deviceId, filters.device));
  if (filters.entity !== undefined) conditions.push(eq(entries.entityId, filters.entity));
  if (filters.from !== undefined) {
    conditions.push(
      sql`${entries.createdAt} >= ((${filters.from})::date)::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE}`,
    );
  }
  if (filters.to !== undefined) {
    conditions.push(
      sql`${entries.createdAt} < ((${filters.to})::date + 1)::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE}`,
    );
  }
  if (filters.after !== undefined) {
    conditions.push(
      sql`(${entries.createdAt}, ${entries.id}) < (SELECT e.created_at, e.id FROM core_audit.entries e WHERE e.id = ${filters.after})`,
    );
  }
  const rows = await tx
    .select()
    .from(entries)
    .where(and(...conditions))
    .orderBy(desc(entries.createdAt), desc(entries.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);

  const users = await directory.users(tx);
  const devices = await directory.devices(tx);
  const userById = new Map(users.map((user) => [user.id, user]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const items = page.map((row): AuditEntryView => ({
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    source: row.source,
    user:
      row.createdBy === null
        ? null
        : (userById.get(row.createdBy) ?? { id: row.createdBy, name: "" }),
    device:
      row.deviceId === null
        ? null
        : (deviceById.get(row.deviceId) ?? { id: row.deviceId, name: "", prefix: "" }),
    action: row.action,
    entity:
      row.entityType === null || row.entityId === null
        ? null
        : { type: row.entityType, id: row.entityId },
    before: asValues(row.before),
    after: asValues(row.after),
    reason: row.reason,
  }));
  return { items, next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

function asValues(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The last change of one record, as `lastChanges` finds it; the caller names the user. */
export interface LastChangeEntry {
  readonly entryId: string;
  readonly at: Date;
  readonly userId: string | null;
  /** Made through Vertex support: its `after` says `issuedBy` or `clearedBy` `support`. */
  readonly bySupport: boolean;
}

/**
 * The newest entry of each of `ids` (records of `entityType`) whose action is one of `actions` —
 * the changes the record's module counts, not every event naming it (a sign-in names its user
 * too). Records without such an entry are left out. For the «last changed by … on …» line of
 * details panels (`core-foundation` slice 20).
 */
export async function lastChanges(
  tx: TenantTransaction,
  entityType: string,
  ids: readonly string[],
  actions: readonly string[],
): Promise<Map<string, LastChangeEntry>> {
  const result = new Map<string, LastChangeEntry>();
  if (ids.length === 0 || actions.length === 0) return result;
  const rows = await tx
    .selectDistinctOn([entries.entityId], {
      entityId: entries.entityId,
      entryId: entries.id,
      at: entries.createdAt,
      userId: entries.createdBy,
      bySupport: sql<boolean>`coalesce(${entries.after}->>'issuedBy' = 'support' or ${entries.after}->>'clearedBy' = 'support', false)`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.entityType, entityType),
        inArray(entries.entityId, [...new Set(ids)]),
        inArray(entries.action, [...new Set(actions)]),
      ),
    )
    .orderBy(entries.entityId, desc(entries.createdAt), desc(entries.id));
  for (const row of rows) {
    if (row.entityId === null) continue;
    result.set(row.entityId, {
      entryId: row.entryId,
      at: row.at,
      userId: row.userId,
      bySupport: row.bySupport,
    });
  }
  return result;
}

/** Every action code the tenant's log holds, for the action filter. */
export async function auditActions(tx: TenantTransaction): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ action: entries.action })
    .from(entries)
    .orderBy(asc(entries.action));
  return rows.map((row) => row.action);
}
