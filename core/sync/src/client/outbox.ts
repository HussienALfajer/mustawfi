import { type LocalExecutor, type LocalMigration, localOrm, safeInteger } from "@mustawfi/local-db";
import { and, asc, count, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { OperationResult, SyncOperation, SyncValues } from "../shared/index.ts";

/**
 * The outbox (ADR-0020): every operation the device performed, in `deviceSeq` order, kept
 * after the server answers so nothing is dropped silently — a rejected one stays visible.
 */
export const syncOutbox = sqliteTable("sync_outbox", {
  deviceSeq: safeInteger("device_seq").primaryKey(),
  opId: text("op_id").notNull(),
  type: text().notNull(),
  payloadVersion: safeInteger("payload_version").notNull(),
  /** JSON. */
  payload: text().notNull(),
  userId: text("user_id").notNull(),
  shiftId: text("shift_id").notNull(),
  createdAt: text("created_at").notNull(),
  state: text().$type<OutboxState>().notNull(),
  /** The server's result (JSON), once accepted or duplicate. */
  result: text(),
  rejectionCode: text("rejection_code"),
  rejectionDetail: text("rejection_detail"),
});

/** Named counters: the device's `deviceSeq` and one number sequence per document type. */
const syncCounters = sqliteTable("sync_counters", {
  name: text().primaryKey(),
  value: safeInteger().notNull(),
});

/** Small facts of the sync loop: the pull cursor; after a wipe, when the device was removed. */
export const syncState = sqliteTable("sync_state", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const OUTBOX_TABLE = "sync_outbox";

/** `core.sync`'s local schema (ADR-0019). */
export const syncLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.sync.0001_outbox",
    statements: [
      `CREATE TABLE sync_outbox (
        device_seq INTEGER PRIMARY KEY CHECK (device_seq > 0),
        op_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        payload_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        user_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'duplicate', 'rejected')),
        result TEXT,
        rejection_code TEXT,
        rejection_detail TEXT
      ) STRICT`,
      "CREATE INDEX sync_outbox_state ON sync_outbox (state, device_seq)",
      `CREATE TABLE sync_counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL CHECK (value > 0)
      ) STRICT`,
      `CREATE TABLE sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT`,
    ],
  },
];

/** `pending` until the server answers; then what it answered (ADR-0020). */
export type OutboxState = "pending" | "accepted" | "duplicate" | "rejected";

/** The next value of a named counter, allocated in `tx` (so a rollback gives it back). */
async function nextCounter(tx: LocalExecutor, name: string): Promise<number> {
  const [row] = await localOrm(tx)
    .insert(syncCounters)
    .values({ name, value: 1 })
    .onConflictDoUpdate({
      target: syncCounters.name,
      set: { value: sql`${syncCounters.value} + 1` },
    })
    .returning({ value: syncCounters.value });
  if (row === undefined) throw new Error(`counter ${name} returned nothing`);
  return row.value;
}

/**
 * The next number in this device's sequence for documents of `docCode` (`INV`), from 1 without
 * gaps (ADR-0020). Call it in the transaction that writes the document.
 */
export function nextDocumentSeq(tx: LocalExecutor, docCode: string): Promise<number> {
  return nextCounter(tx, `doc:${docCode}`);
}

export interface NewOperation {
  readonly opId: string;
  readonly deviceId: string;
  readonly type: string;
  readonly payloadVersion: number;
  readonly payload: SyncValues;
  readonly userId: string;
  readonly shiftId: string;
  /** The device's clock. */
  readonly createdAt: Date;
}

/**
 * Appends an operation to the outbox in `tx`, the transaction that records what it carries
 * (a sale, its number, and its outbox entry commit together — ADR-0019), with the device's next
 * `deviceSeq`.
 */
export async function enqueueOperation(
  tx: LocalExecutor,
  operation: NewOperation,
): Promise<SyncOperation> {
  const deviceSeq = await nextCounter(tx, "deviceSeq");
  const envelope: SyncOperation = {
    opId: operation.opId,
    deviceId: operation.deviceId,
    deviceSeq,
    type: operation.type,
    payloadVersion: operation.payloadVersion,
    payload: operation.payload,
    userId: operation.userId,
    shiftId: operation.shiftId,
    createdAt: operation.createdAt.toISOString(),
  };
  await localOrm(tx)
    .insert(syncOutbox)
    .values({
      deviceSeq,
      opId: envelope.opId,
      type: envelope.type,
      payloadVersion: envelope.payloadVersion,
      payload: JSON.stringify(envelope.payload),
      userId: envelope.userId,
      shiftId: envelope.shiftId,
      createdAt: envelope.createdAt,
      state: "pending",
    });
  return envelope;
}

/** The oldest pending operations, in `deviceSeq` order, as the server takes them. */
export async function pendingOperations(
  executor: LocalExecutor,
  deviceId: string,
  limit: number,
): Promise<SyncOperation[]> {
  const rows = await localOrm(executor)
    .select()
    .from(syncOutbox)
    .where(eq(syncOutbox.state, "pending"))
    .orderBy(asc(syncOutbox.deviceSeq))
    .limit(limit);
  return rows.map((row) => ({
    opId: row.opId,
    deviceId,
    deviceSeq: row.deviceSeq,
    type: row.type,
    payloadVersion: row.payloadVersion,
    payload: JSON.parse(row.payload) as SyncValues,
    userId: row.userId,
    shiftId: row.shiftId,
    createdAt: row.createdAt,
  }));
}

/** Records the server's answers in `tx`. */
export async function recordResults(
  tx: LocalExecutor,
  results: readonly OperationResult[],
): Promise<void> {
  const orm = localOrm(tx);
  for (const result of results) {
    const answer =
      result.status === "rejected"
        ? {
            state: "rejected" as const,
            result: null,
            rejectionCode: result.code,
            rejectionDetail: result.detail ?? null,
          }
        : {
            state: result.status,
            result: JSON.stringify(result.result),
            rejectionCode: null,
            rejectionDetail: null,
          };
    await orm
      .update(syncOutbox)
      .set(answer)
      .where(and(eq(syncOutbox.opId, result.opId), eq(syncOutbox.deviceSeq, result.deviceSeq)));
  }
}

/**
 * The server lost track of this device from `nextDeviceSeq` on (a gap): everything from there
 * is sent again. A resend is safe — the server answers a known `opId` with its stored result.
 */
export async function resendFrom(tx: LocalExecutor, nextDeviceSeq: number): Promise<void> {
  await localOrm(tx)
    .update(syncOutbox)
    .set({ state: "pending", result: null, rejectionCode: null, rejectionDetail: null })
    .where(and(gte(syncOutbox.deviceSeq, nextDeviceSeq), ne(syncOutbox.state, "pending")));
}

export interface OutboxCounts {
  /** Waiting for the server. */
  readonly pending: number;
  /** Rejected: kept for review (ADR-0020). */
  readonly needsReview: number;
}

export async function outboxCounts(executor: LocalExecutor): Promise<OutboxCounts> {
  const rows = await localOrm(executor)
    .select({ state: syncOutbox.state, n: count() })
    .from(syncOutbox)
    .where(inArray(syncOutbox.state, ["pending", "rejected"]))
    .groupBy(syncOutbox.state);
  const of = (state: OutboxState) => rows.find((row) => row.state === state)?.n ?? 0;
  return { pending: of("pending"), needsReview: of("rejected") };
}

export interface OperationState {
  readonly state: OutboxState;
  readonly rejectionCode: string | null;
}

/** Where the given operations stand, for the module that shows their documents. */
export async function operationStates(
  executor: LocalExecutor,
  opIds: readonly string[],
): Promise<Map<string, OperationState>> {
  if (opIds.length === 0) return new Map();
  const rows = await localOrm(executor)
    .select({
      opId: syncOutbox.opId,
      state: syncOutbox.state,
      rejectionCode: syncOutbox.rejectionCode,
    })
    .from(syncOutbox)
    .where(inArray(syncOutbox.opId, [...opIds]));
  return new Map(
    rows.map((row) => [row.opId, { state: row.state, rejectionCode: row.rejectionCode }]),
  );
}

const CURSOR_KEY = "pullCursor";

export async function pullCursor(executor: LocalExecutor): Promise<string> {
  const row = await localOrm(executor)
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, CURSOR_KEY))
    .get();
  return row?.value ?? "0";
}

export async function savePullCursor(tx: LocalExecutor, cursor: string): Promise<void> {
  await localOrm(tx)
    .insert(syncState)
    .values({ key: CURSOR_KEY, value: cursor })
    .onConflictDoUpdate({ target: syncState.key, set: { value: cursor } });
}

const REMOVED_KEY = "removedAt";

/**
 * Marks that this device was removed from its store (`core-foundation` rule 23), right after
 * its wipe — the one fact kept, so the app can say why it starts over, until the user
 * acknowledges it.
 */
export async function markRemoved(tx: LocalExecutor, at: Date): Promise<void> {
  await localOrm(tx)
    .insert(syncState)
    .values({ key: REMOVED_KEY, value: at.toISOString() })
    .onConflictDoUpdate({ target: syncState.key, set: { value: at.toISOString() } });
}

/** When this device was removed from its store, if it was and nobody acknowledged it yet. */
export async function removedAt(executor: LocalExecutor): Promise<string | undefined> {
  const row = await localOrm(executor)
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, REMOVED_KEY))
    .get();
  return row?.value;
}

export async function clearRemoved(executor: LocalExecutor): Promise<void> {
  await localOrm(executor).delete(syncState).where(eq(syncState.key, REMOVED_KEY));
}
