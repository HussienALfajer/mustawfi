import { ACCESS_DEVICE_TABLE, localDevice } from "@mustawfi/core-access/client";
import { ApiProblem, apiRequest, ApiUnreachable } from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import type { ChangedTables, LocalDb, LocalExecutor } from "@mustawfi/local-db";
import {
  PULL_PAGE_LIMIT,
  PUSH_BATCH_LIMIT,
  type PullResponse,
  pullResponseSchema,
  type PushResponse,
  pushResponseSchema,
  type SyncChange,
  type SyncOperation,
} from "../shared/index.ts";
import {
  OUTBOX_TABLE,
  outboxCounts,
  pendingOperations,
  pullCursor,
  recordResults,
  resendFrom,
  savePullCursor,
} from "./outbox.ts";

/**
 * Applies pulled changes of one entity to the module's local tables, in the transaction that
 * also saves the cursor (ADR-0020). A `null` row is a tombstone.
 */
export interface PullApplier {
  readonly entity: string;
  apply(tx: LocalExecutor, change: SyncChange): Promise<void>;
}

/** How the engine reaches the server; the default calls the API with the device credential. */
export interface SyncTransport {
  push(credential: string, operations: readonly SyncOperation[]): Promise<PushResponse>;
  pull(credential: string, cursor: string): Promise<PullResponse>;
}

export const apiSyncTransport: SyncTransport = {
  push: (credential, operations) =>
    apiRequest("/api/v1/sync/push", {
      method: "POST",
      body: { operations },
      schema: pushResponseSchema,
      bearer: credential,
    }),
  pull: (credential, cursor) =>
    apiRequest(
      `/api/v1/sync/pull?${new URLSearchParams({ cursor, limit: String(PULL_PAGE_LIMIT) }).toString()}`,
      { schema: pullResponseSchema, bearer: credential },
    ),
};

/**
 * - `unregistered`: this client is not a device yet; nothing syncs.
 * - `idle`: the last round reached the server. `syncing`: a round is running.
 * - `offline`: the server did not answer; sales keep going and wait in the outbox.
 * - `failed`: the server refused the round (`failure` says why), e.g. a revoked device.
 */
export type SyncPhase = "unregistered" | "idle" | "syncing" | "offline" | "failed";

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Operations waiting for the server. */
  readonly pending: number;
  /** Operations the server rejected, kept for review (ADR-0020). */
  readonly needsReview: number;
  /** When a round last reached the server, by the device's clock. */
  readonly lastSyncedAt: string | null;
  /** The problem code of a `failed` round. */
  readonly failure: string | null;
}

export interface SyncEngine {
  /** Runs a round now, or once more after the one in flight. Never throws. */
  syncNow(): Promise<void>;
  /**
   * Rounds every `intervalMs`, and at once when the outbox gains an operation or the device
   * registers.
   */
  start(): void;
  stop(): void;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
}

export interface SyncEngineOptions {
  readonly db: LocalDb;
  readonly appliers: readonly PullApplier[];
  readonly clock: Clock;
  readonly transport?: SyncTransport;
  readonly intervalMs?: number;
}

/** Pages a round pulls at most, so a long catch-up yields to pushes in between. */
const PULL_PAGES_PER_ROUND = 20;
/** Push batches a round sends at most. */
const PUSH_BATCHES_PER_ROUND = 20;

/**
 * The device's sync loop (ADR-0020): push the outbox in `deviceSeq` order, record each answer,
 * then pull the change log from the saved cursor, applying each page and its cursor in one local
 * transaction. The network never blocks a sale: the loop runs beside it.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { db, clock } = options;
  const transport = options.transport ?? apiSyncTransport;
  const appliers = new Map(options.appliers.map((applier) => [applier.entity, applier]));
  const listeners = new Set<() => void>();
  let status: SyncStatus = {
    phase: "idle",
    pending: 0,
    needsReview: 0,
    lastSyncedAt: null,
    failure: null,
  };
  let running: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  function update(next: Partial<SyncStatus>): void {
    const merged = { ...status, ...next };
    if ((Object.keys(merged) as (keyof SyncStatus)[]).every((key) => merged[key] === status[key])) {
      return;
    }
    status = merged;
    for (const listener of listeners) listener();
  }

  async function refreshCounts(): Promise<void> {
    update(await outboxCounts(db));
  }

  async function push(credential: string, deviceId: string): Promise<void> {
    for (let batch = 0; batch < PUSH_BATCHES_PER_ROUND; batch += 1) {
      const operations = await pendingOperations(db, deviceId, PUSH_BATCH_LIMIT);
      if (operations.length === 0) return;
      const response = await transport.push(credential, operations);
      await db.transaction(async (tx) => {
        await recordResults(tx, response.results);
        if (response.gap) await resendFrom(tx, response.nextDeviceSeq);
      });
      // Nothing answered (a gap before the first one sent): the resend starts next round.
      if (response.results.length === 0 && !response.gap) return;
    }
  }

  async function pull(credential: string): Promise<void> {
    for (let page = 0; page < PULL_PAGES_PER_ROUND; page += 1) {
      const cursor = await pullCursor(db);
      const response = await transport.pull(credential, cursor);
      await db.transaction(async (tx) => {
        for (const change of response.changes) {
          // An entity this app version does not know stays unapplied; a newer app pulls it
          // from a fresh bootstrap (`core-sync`).
          await appliers.get(change.entity)?.apply(tx, change);
        }
        await savePullCursor(tx, response.cursor);
      });
      if (!response.more) return;
    }
  }

  async function round(): Promise<void> {
    const device = await localDevice(db);
    if (device === undefined) {
      update({ phase: "unregistered" });
      await refreshCounts();
      return;
    }
    update({ phase: "syncing" });
    try {
      await push(device.credential, device.deviceId);
      await pull(device.credential);
      update({ phase: "idle", failure: null, lastSyncedAt: clock.now().toISOString() });
    } catch (error) {
      if (error instanceof ApiUnreachable) {
        update({ phase: "offline" });
      } else {
        update({
          phase: "failed",
          failure:
            error instanceof ApiProblem
              ? error.code
              : error instanceof Error
                ? error.name
                : "unknown",
        });
      }
    } finally {
      await refreshCounts();
    }
  }

  function syncNow(): Promise<void> {
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await round().catch(() => undefined);
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  function onChange(tables: ChangedTables): void {
    // The engine's own writes land here too; they cost at most one more round, which finds
    // nothing to push. Telling them apart by timing would drop a sale committed meanwhile.
    // A new operation to send, or a device just registered (its first pull).
    if (tables.has(OUTBOX_TABLE) || tables.has(ACCESS_DEVICE_TABLE) || tables.has("*")) {
      void refreshCounts();
      void syncNow();
    }
  }

  return {
    syncNow,
    start() {
      if (timer !== undefined) return;
      unsubscribe = db.subscribe(onChange);
      timer = setInterval(() => void syncNow(), options.intervalMs ?? 15_000);
      void refreshCounts();
      void syncNow();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
