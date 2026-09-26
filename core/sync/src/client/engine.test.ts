import { accessLocalMigrations } from "@mustawfi/core-access/client";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, localOrm, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  OperationResult,
  PullResponse,
  PushResponse,
  SyncChange,
  SyncOperation,
} from "../shared/index.ts";
import { createSyncEngine, type PullApplier, type SyncTransport } from "./engine.ts";
import { enqueueOperation, syncLocalMigrations, syncOutbox } from "./outbox.ts";

const clock = manualClock(new Date("2026-09-25T10:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const deviceId = newId();
const CREDENTIAL = "d1.fixture";

/**
 * A server double: answers pushes as ADR-0020 says (idempotent by `opId`, a gap stops
 * processing), serves a change log in pages, and can be told to be unreachable.
 */
class FakeServer implements SyncTransport {
  readonly received = new Map<string, OperationResult>();
  nextDeviceSeq = 1;
  reachable = true;
  /** Rejects operations whose payload has `reject: true`. */
  pushes: SyncOperation[][] = [];
  changes: SyncChange[] = [];
  pageSize = 2;
  credentials: string[] = [];
  /** The device is revoked: pushes still land, answered `revoked`; pulls are refused. */
  revoked = false;
  /** How many operations a push answers at most, as a push cut short by a dropped answer. */
  answerAtMost = Number.POSITIVE_INFINITY;
  /** Runs after a push is answered, before the device records the answer. */
  afterPush: (() => Promise<void>) | undefined;
  wipeReports: string[] = [];
  reachableForReport = true;

  push(credential: string, operations: readonly SyncOperation[]): Promise<PushResponse> {
    this.credentials.push(credential);
    if (!this.reachable) return Promise.reject(new ApiUnreachable("down"));
    this.pushes.push([...operations]);
    const results: OperationResult[] = [];
    const revoked = this.revoked;
    for (const operation of operations.slice(0, this.answerAtMost)) {
      const known = this.received.get(operation.opId);
      if (known !== undefined) {
        results.push(known.status === "accepted" ? { ...known, status: "duplicate" } : known);
        continue;
      }
      if (operation.deviceSeq !== this.nextDeviceSeq) {
        return Promise.resolve({
          results,
          nextDeviceSeq: this.nextDeviceSeq,
          gap: true,
          revoked,
        });
      }
      const result: OperationResult =
        operation.payload["reject"] === true
          ? {
              opId: operation.opId,
              deviceSeq: operation.deviceSeq,
              status: "rejected",
              code: "sales.invoice.invalid",
            }
          : {
              opId: operation.opId,
              deviceSeq: operation.deviceSeq,
              status: "accepted",
              result: { ok: true },
            };
      this.received.set(operation.opId, result);
      this.nextDeviceSeq += 1;
      results.push(result);
    }
    const answer = { results, nextDeviceSeq: this.nextDeviceSeq, gap: false, revoked };
    return this.afterPush === undefined
      ? Promise.resolve(answer)
      : this.afterPush().then(() => answer);
  }

  pull(credential: string, cursor: string): Promise<PullResponse> {
    this.credentials.push(credential);
    if (!this.reachable) return Promise.reject(new ApiUnreachable("down"));
    if (this.revoked) return Promise.reject(new ApiProblem("access.device.revoked", 401));
    const from = Number.parseInt(cursor, 10);
    const page = this.changes.slice(from, from + this.pageSize);
    const next = from + page.length;
    return Promise.resolve({
      changes: page,
      cursor: String(next),
      more: next < this.changes.length,
    });
  }

  reportWiped(credential: string): Promise<void> {
    if (!this.reachableForReport) return Promise.reject(new ApiUnreachable("down"));
    this.wipeReports.push(credential);
    return Promise.resolve();
  }
}

let db: LocalDb;
let server: FakeServer;
const applied: string[] = [];

/** Applies `test.item` changes by recording them in a table of its own. */
const itemApplier: PullApplier = {
  entity: "test.item",
  async apply(tx, change) {
    if (change.row?.["fail"] === true) throw new Error("applier failed");
    await tx.run("INSERT INTO test_items (id) VALUES (?)", [change.id]);
    applied.push(change.id);
  },
};

async function registerDevice() {
  await db.run(
    `INSERT INTO access_device (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
     VALUES (?, ?, 'K7', 'الصندوق', 'mainPos', ?, 'SYP', ?)`,
    [deviceId, newId(), CREDENTIAL, clock.now().toISOString()],
  );
}

function enqueue(payload: Record<string, boolean> = {}) {
  return db.transaction((tx) =>
    enqueueOperation(tx, {
      opId: newId(),
      deviceId,
      type: "sales.invoice.post",
      payloadVersion: 1,
      payload,
      userId: newId(),
      shiftId: newId(),
      createdAt: clock.now(),
    }),
  );
}

async function states() {
  return (
    await localOrm(db)
      .select({ seq: syncOutbox.deviceSeq, state: syncOutbox.state })
      .from(syncOutbox)
      .orderBy(syncOutbox.deviceSeq)
  ).map((row) => `${String(row.seq)}:${row.state}`);
}

function change(id: string, row: Record<string, unknown> = {}): SyncChange {
  return { entity: "test.item", id, row: { id, ...row } };
}

const MIGRATIONS = [
  ...accessLocalMigrations,
  ...syncLocalMigrations,
  { id: "test.0001_items", statements: ["CREATE TABLE test_items (id TEXT PRIMARY KEY)"] },
];

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, MIGRATIONS);
  server = new FakeServer();
  applied.length = 0;
});

afterEach(async () => {
  await db.close();
});

function engine() {
  return createSyncEngine({
    db,
    migrations: MIGRATIONS,
    appliers: [itemApplier],
    clock,
    transport: server,
  });
}

describe("the sync engine", () => {
  it("does nothing on an unregistered device", async () => {
    await enqueue();
    const sync = engine();
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ phase: "unregistered", pending: 1 });
    expect(server.credentials).toEqual([]);
  });

  it("pushes the outbox in deviceSeq order with the device credential, then pulls", async () => {
    await registerDevice();
    const operations = [await enqueue(), await enqueue(), await enqueue({ reject: true })];
    server.changes = [change("a"), change("b"), change("c")];
    const sync = engine();
    await sync.syncNow();

    expect(server.pushes).toEqual([operations]);
    expect(new Set(server.credentials)).toEqual(new Set([CREDENTIAL]));
    // A rejected operation stays, visible, for review (ADR-0020).
    expect(await states()).toEqual(["1:accepted", "2:accepted", "3:rejected"]);
    expect(applied).toEqual(["a", "b", "c"]);
    expect(sync.status()).toEqual({
      phase: "idle",
      pending: 0,
      needsReview: 1,
      lastSyncedAt: "2026-09-25T10:00:00.000Z",
      failure: null,
    });

    // Nothing new: nothing is pushed again, and the cursor saved the pulled pages.
    await sync.syncNow();
    expect(server.pushes).toHaveLength(1);
    expect(applied).toEqual(["a", "b", "c"]);
  });

  it("keeps sales in the outbox while the server is unreachable, and sends them later", async () => {
    await registerDevice();
    server.reachable = false;
    await enqueue();
    const sync = engine();
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ phase: "offline", pending: 1, lastSyncedAt: null });
    expect(await states()).toEqual(["1:pending"]);

    await enqueue();
    server.reachable = true;
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ phase: "idle", pending: 0 });
    expect(await states()).toEqual(["1:accepted", "2:accepted"]);
  });

  it("records a lost answer as a duplicate on the resend", async () => {
    await registerDevice();
    const [first] = [await enqueue()];
    // The server recorded it, but the answer never came back.
    await server.push(CREDENTIAL, [first]);
    await engine().syncNow();
    expect(await states()).toEqual(["1:duplicate"]);
    expect(server.received.size).toBe(1);
  });

  it("resends from where the server says it stopped after a gap", async () => {
    await registerDevice();
    await enqueue();
    await enqueue();
    await engine().syncNow();
    expect(await states()).toEqual(["1:accepted", "2:accepted"]);
    // The server lost the device's last operation (a restore), then a new one arrives.
    server.nextDeviceSeq = 2;
    server.received.clear();
    await enqueue();
    await engine().syncNow();
    expect(server.pushes.at(-1)?.map((operation) => operation.deviceSeq)).toEqual([2, 3]);
    expect(await states()).toEqual(["1:accepted", "2:accepted", "3:accepted"]);
  });

  it("applies a page and its cursor together: a failing page is pulled again", async () => {
    await registerDevice();
    server.changes = [change("a"), change("b"), change("c", { fail: true }), change("d")];
    const sync = engine();
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ phase: "failed", failure: "Error" });
    expect(applied).toEqual(["a", "b", "c"].slice(0, 2));
    expect(
      (await db.query("SELECT id FROM test_items ORDER BY id")).map((row) => row["id"]),
    ).toEqual(["a", "b"]);

    server.changes[2] = change("c");
    await sync.syncNow();
    expect(
      (await db.query("SELECT id FROM test_items ORDER BY id")).map((row) => row["id"]),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("reports a refused device as a failure with its code", async () => {
    await registerDevice();
    const refusing: SyncTransport = {
      push: () => Promise.reject(new ApiProblem("access.device.required", 401)),
      pull: () => Promise.reject(new ApiProblem("access.device.required", 401)),
      reportWiped: () => Promise.resolve(),
    };
    await enqueue();
    const sync = createSyncEngine({
      db,
      migrations: MIGRATIONS,
      appliers: [],
      clock,
      transport: refusing,
    });
    await sync.syncNow();
    expect(sync.status()).toMatchObject({
      phase: "failed",
      failure: "access.device.required",
      pending: 1,
    });
  });

  it("starts a round when the device registers, and when a sale enters the outbox", async () => {
    server.changes = [change("a")];
    const sync = engine();
    sync.start();
    try {
      await sync.syncNow();
      expect(sync.status().phase).toBe("unregistered");
      await registerDevice();
      await expect.poll(() => applied).toEqual(["a"]);
      await enqueue();
      await expect.poll(() => server.pushes.length).toBe(1);
      await expect.poll(() => sync.status().pending).toBe(0);
    } finally {
      sync.stop();
    }
  });
});

/** Rows left in every table the wipe empties: the device, the outbox, a module's own data. */
async function leftOnDevice() {
  const count = async (table: string) =>
    (await db.query(`SELECT count(*) AS n FROM ${table}`))[0]?.["n"];
  return {
    device: await count("access_device"),
    outbox: await count("sync_outbox"),
    items: await count("test_items"),
  };
}

describe("a revoked device (core-foundation rule 23)", () => {
  it("pushes what it holds, then wipes its data, reports the wipe, and says it was removed", async () => {
    await registerDevice();
    server.changes = [change("a")];
    await engine().syncNow();
    expect(await leftOnDevice()).toEqual({ device: 1n, outbox: 0n, items: 1n });

    server.revoked = true;
    const sales = [await enqueue(), await enqueue({ reject: true })];
    let wipes = 0;
    const sync = createSyncEngine({
      db,
      migrations: MIGRATIONS,
      appliers: [itemApplier],
      clock,
      transport: server,
      onWiped: () => {
        wipes += 1;
        return Promise.resolve();
      },
    });
    await sync.syncNow();

    // Every sale reached the server first; the rejected one had its answer too.
    expect(server.pushes.at(-1)).toEqual(sales);
    expect(server.received.size).toBe(2);
    expect(await leftOnDevice()).toEqual({ device: 0n, outbox: 0n, items: 0n });
    expect(server.wipeReports).toEqual([CREDENTIAL]);
    expect(wipes).toBe(1);
    expect(sync.status()).toMatchObject({ phase: "removed", pending: 0, needsReview: 0 });

    // It stays removed, across a restart of the app, until the user has read it.
    const restarted = engine();
    await restarted.syncNow();
    expect(restarted.status().phase).toBe("removed");
    await restarted.acknowledgeRemoval();
    expect(restarted.status().phase).toBe("unregistered");
  });

  it("keeps everything while an operation has no answer yet, and wipes once it has", async () => {
    await registerDevice();
    server.revoked = true;
    await enqueue();
    await enqueue();
    server.answerAtMost = 1;
    server.reachable = true;
    const sync = engine();
    // The push answers one operation, then the network drops: one has no answer, nothing wiped.
    server.afterPush = () => {
      server.reachable = false;
      return Promise.resolve();
    };
    await sync.syncNow();
    expect(await states()).toEqual(["1:accepted", "2:pending"]);
    expect(sync.status()).toMatchObject({ phase: "offline", pending: 1 });
    expect(await leftOnDevice()).toMatchObject({ device: 1n, outbox: 2n });

    server.afterPush = undefined;
    server.reachable = true;
    server.answerAtMost = Number.POSITIVE_INFINITY;
    await sync.syncNow();
    expect(server.received.size).toBe(2);
    expect(await leftOnDevice()).toEqual({ device: 0n, outbox: 0n, items: 0n });
    expect(sync.status().phase).toBe("removed");
  });

  it("sends a sale committed just before the wipe first, and wipes after it", async () => {
    await registerDevice();
    server.revoked = true;
    await enqueue();
    // A sale commits between the last push and the wipe: the wipe's transaction sees it.
    let transactions = 0;
    let late: SyncOperation | undefined;
    const racing: LocalDb = {
      query: (sql, params) => db.query(sql, params),
      run: (sql, params) => db.run(sql, params),
      subscribe: (listener) => db.subscribe(listener),
      close: () => db.close(),
      async transaction(work) {
        transactions += 1;
        // The first records the push's answers; the second is the wipe.
        if (transactions === 2) late = await enqueue();
        return db.transaction(work);
      },
    };
    const sync = createSyncEngine({
      db: racing,
      migrations: MIGRATIONS,
      appliers: [],
      clock,
      transport: server,
    });
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ phase: "revoked", pending: 1 });
    expect(await leftOnDevice()).toMatchObject({ device: 1n, outbox: 2n });

    await sync.syncNow();
    expect(late === undefined ? false : server.received.has(late.opId)).toBe(true);
    expect(await leftOnDevice()).toEqual({ device: 0n, outbox: 0n, items: 0n });
    expect(sync.status().phase).toBe("removed");
  });

  it("wipes on a refused pull when nothing is left to push", async () => {
    await registerDevice();
    server.revoked = true;
    const sync = engine();
    await sync.syncNow();
    expect(server.pushes).toEqual([]);
    expect(await leftOnDevice()).toEqual({ device: 0n, outbox: 0n, items: 0n });
    expect(sync.status().phase).toBe("removed");
  });

  it("stays wiped when the wipe cannot be reported", async () => {
    await registerDevice();
    server.revoked = true;
    server.reachableForReport = false;
    const sync = engine();
    await sync.syncNow();
    expect(server.wipeReports).toEqual([]);
    expect(await leftOnDevice()).toEqual({ device: 0n, outbox: 0n, items: 0n });
    expect(sync.status().phase).toBe("removed");
  });
});
