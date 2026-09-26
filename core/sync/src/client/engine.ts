import {
  ACCESS_DEVICE_TABLE,
  type LocalDevice,
  localDevice,
  reportDeviceWiped,
} from "@mustawfi/core-access/client";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import {
  acceptBundle,
  ApiProblem,
  apiRequest,
  ApiUnreachable,
  type BundleVerifier,
  holdDeviceCredential,
  holdSessionToken,
  storedBundleVersion,
} from "@mustawfi/core-config/client";
import { type BundleResponse, bundleResponseSchema } from "@mustawfi/core-config/shared";
import type { Clock } from "@mustawfi/kernel";
import {
  type ChangedTables,
  compactLocalDb,
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  wipeLocalDb,
} from "@mustawfi/local-db";
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
  clearRemoved,
  markRemoved,
  OUTBOX_TABLE,
  outboxCounts,
  pendingOperations,
  pullCursor,
  recordResults,
  removedAt,
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
  /** A revoked device reports its wipe with the credential it held (rule 23). */
  reportWiped(credential: string): Promise<void>;
  /** The configuration bundle, unless the device already holds `version` (rule 12). */
  bundle(credential: string, version: number): Promise<BundleResponse>;
}

export interface ApiSyncTransportOptions {
  /** How requests travel; the platform `fetch` by default. */
  readonly fetch?: typeof fetch;
}

/** The sync API over HTTP with the device credential (ADR-0020). */
export function createApiSyncTransport(options: ApiSyncTransportOptions = {}): SyncTransport {
  const via = options.fetch === undefined ? {} : { fetch: options.fetch };
  return {
    push: (credential, operations) =>
      apiRequest("/api/v1/sync/push", {
        method: "POST",
        body: { operations },
        schema: pushResponseSchema,
        bearer: credential,
        ...via,
      }),
    pull: (credential, cursor) =>
      apiRequest(
        `/api/v1/sync/pull?${new URLSearchParams({ cursor, limit: String(PULL_PAGE_LIMIT) }).toString()}`,
        { schema: pullResponseSchema, bearer: credential, ...via },
      ),
    reportWiped: (credential) => reportDeviceWiped(credential, via),
    bundle: (credential, version) =>
      apiRequest(
        `/api/v1/sync/bundle?${new URLSearchParams({ version: String(version) }).toString()}`,
        { schema: bundleResponseSchema, bearer: credential, ...via },
      ),
  };
}

export const apiSyncTransport: SyncTransport = createApiSyncTransport();

/**
 * - `unregistered`: this client is not a device yet; nothing syncs.
 * - `idle`: the last round reached the server. `syncing`: a round is running.
 * - `offline`: the server did not answer; sales keep going and wait in the outbox.
 * - `failed`: the server refused the round (`failure` says why).
 * - `revoked`: the device was removed from its store; it still sends what it holds, and wipes
 *   once every operation has an answer (`core-foundation` rule 23).
 * - `removed`: the device wiped its local data after its revoke; the app says so until the
 *   user acknowledges it (`acknowledgeRemoval`), then it is `unregistered`.
 */
export type SyncPhase =
  "unregistered" | "idle" | "syncing" | "offline" | "failed" | "revoked" | "removed";

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
  /** Once the user has read that the device was removed: it starts over as unregistered. */
  acknowledgeRemoval(): Promise<void>;
}

export interface SyncEngineOptions {
  readonly db: LocalDb;
  /** The app's local schema: a revoked device's wipe drops every table and applies it again. */
  readonly migrations: readonly LocalMigration[];
  readonly appliers: readonly PullApplier[];
  readonly clock: Clock;
  readonly transport?: SyncTransport;
  readonly intervalMs?: number;
  /**
   * Runs after a wipe, before it is reported: the Windows app deletes its database copies here
   * (ADR-0019). A failure does not undo the wipe, which has already happened.
   */
  readonly onWiped?: () => Promise<unknown>;
  /**
   * How this app checks configuration bundles (keys and part decoders). With it, every round
   * that reaches the server fetches the bundle once push and pull are done, and a new version
   * is verified before it replaces the stored one (`core-foundation` rules 11–12).
   */
  readonly bundle?: BundleVerifier;
}

/** Pages a round pulls at most, so a long catch-up yields to pushes in between. */
const PULL_PAGES_PER_ROUND = 20;
/** Push batches a round sends at most. */
const PUSH_BATCHES_PER_ROUND = 20;

/**
 * The device's sync loop (ADR-0020): push the outbox in `deviceSeq` order, record each answer,
 * then pull the change log from the saved cursor, applying each page and its cursor in one local
 * transaction. The network never blocks a sale: the loop runs beside it.
 *
 * A revoked device (`core-foundation` rule 23) learns it from the push answer, or from a
 * refused pull. It keeps pushing until every operation has an answer, then wipes its local
 * data — dropping every table in one transaction that first checks that nothing is pending, so
 * a sale committed meanwhile is sent first, then rebuilding the empty schema — forgets its
 * credential, and reports the wipe if it can.
 *
 * After push and pull, the device asks for its configuration bundle with the version it holds;
 * a refused bundle is recorded and the previous one kept, without failing the round.
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

  /** Pushes the outbox; resolves to whether the server said the device is revoked. */
  async function push(credential: string, deviceId: string): Promise<boolean> {
    let revoked = false;
    for (let batch = 0; batch < PUSH_BATCHES_PER_ROUND; batch += 1) {
      const operations = await pendingOperations(db, deviceId, PUSH_BATCH_LIMIT);
      if (operations.length === 0) return revoked;
      const response = await transport.push(credential, operations);
      revoked ||= response.revoked;
      await db.transaction(async (tx) => {
        await recordResults(tx, response.results);
        if (response.gap) await resendFrom(tx, response.nextDeviceSeq);
      });
      // Nothing answered (a gap before the first one sent): the resend starts next round.
      if (response.results.length === 0 && !response.gap) return revoked;
    }
    return revoked;
  }

  /**
   * The device is revoked: once every operation has an answer, wipe the local data and say so;
   * until then, the next round pushes what is left.
   */
  async function wipeWhenAnswered(device: LocalDevice): Promise<void> {
    const wiped = await wipeLocalDb(db, {
      migrations: options.migrations,
      when: async (tx) => (await outboxCounts(tx)).pending === 0,
    });
    if (!wiped) {
      update({ phase: "revoked", failure: null });
      return;
    }
    // The one fact the wipe keeps, so the app can say why it starts over.
    await markRemoved(db, clock.now());
    holdDeviceCredential(undefined);
    holdSessionToken(undefined);
    // The rows are gone; these make the files forget them too. Best effort: the wipe stands.
    await compactLocalDb(db).catch(() => undefined);
    await options.onWiped?.().catch(() => undefined);
    await transport.reportWiped(device.credential).catch(() => undefined);
    update({ phase: "removed", failure: null });
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

  async function refreshBundle(device: LocalDevice, verifier: BundleVerifier): Promise<void> {
    const response = await transport.bundle(device.credential, await storedBundleVersion(db));
    await acceptBundle(
      db,
      response,
      verifier,
      { deviceId: device.deviceId, tenantId: device.tenantId },
      clock,
    );
  }

  async function round(): Promise<void> {
    const device = await localDevice(db);
    if (device === undefined) {
      update({ phase: (await removedAt(db)) === undefined ? "unregistered" : "removed" });
      await refreshCounts();
      return;
    }
    update({ phase: "syncing" });
    try {
      let revoked = false;
      try {
        revoked = await push(device.credential, device.deviceId);
        if (!revoked) await pull(device.credential);
        if (!revoked && options.bundle !== undefined) await refreshBundle(device, options.bundle);
      } catch (error) {
        // Pull refused the credential: the device was revoked while its outbox was empty.
        if (!(error instanceof ApiProblem && error.code === accessProblemCodes.deviceRevoked)) {
          throw error;
        }
        revoked = true;
      }
      if (revoked) await wipeWhenAnswered(device);
      else update({ phase: "idle", failure: null, lastSyncedAt: clock.now().toISOString() });
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
    async acknowledgeRemoval() {
      await clearRemoved(db);
      await syncNow();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
