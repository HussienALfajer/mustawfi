import { accessLocalMigrations } from "@mustawfi/core-access/client";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_AUDIT_OPERATION, deviceAuditPayloadSchema } from "../shared/index.ts";
import { outboxAuditSink } from "./audit-sink.ts";
import { enqueueOperation, pendingOperations, syncLocalMigrations } from "./outbox.ts";

const clock = manualClock(new Date("2026-09-26T07:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const SHIFT = "00000000-0000-7000-8000-000000000002";
const USER = "0199a000-0000-7000-8000-0000000000aa";
const deviceId = newId();
const sink = outboxAuditSink({ clock, newId, shiftId: SHIFT });

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [...accessLocalMigrations, ...syncLocalMigrations]);
});

afterEach(async () => {
  await db.close();
});

async function registerDevice() {
  await db.run(
    `INSERT INTO access_device (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
     VALUES (?, ?, 'K7', 'الصندوق', 'mainPos', 'credential', 'SYP', ?)`,
    [deviceId, newId(), clock.now().toISOString()],
  );
}

describe("the outbox audit sink (the device audit path)", () => {
  it("queues the event as audit.entry.record, after the operations before it, with the device's time", async () => {
    await registerDevice();
    await db.transaction((tx) =>
      enqueueOperation(tx, {
        opId: newId(),
        deviceId,
        type: "sales.invoice.post",
        payloadVersion: 1,
        payload: {},
        userId: USER,
        shiftId: SHIFT,
        createdAt: clock.now(),
      }),
    );
    clock.advance(1_000);
    await db.transaction((tx) =>
      sink.record(tx, {
        action: "tenancy.clock.movedBack",
        userId: USER,
        entity: { type: "tenancy.license", id: deviceId },
        after: { localTime: "2026-09-26T06:00:00.000Z" },
      }),
    );
    const [, operation] = await pendingOperations(db, deviceId, 10);
    expect(operation).toEqual({
      opId: expect.any(String) as unknown,
      deviceId,
      deviceSeq: 2,
      type: DEVICE_AUDIT_OPERATION,
      payloadVersion: 1,
      payload: {
        action: "tenancy.clock.movedBack",
        entity: { type: "tenancy.license", id: deviceId },
        after: { localTime: "2026-09-26T06:00:00.000Z" },
      },
      userId: USER,
      shiftId: SHIFT,
      createdAt: "2026-09-26T07:00:01.000Z",
    });
    // What the server's handler reads.
    expect(deviceAuditPayloadSchema.safeParse(operation?.payload).success).toBe(true);
  });

  it("writes in the caller's transaction: nothing is queued when it rolls back", async () => {
    await registerDevice();
    await expect(
      db.transaction(async (tx) => {
        await sink.record(tx, { action: "tenancy.clock.movedBack", userId: USER });
        throw new Error("the change it records failed");
      }),
    ).rejects.toThrow("the change it records failed");
    expect(await pendingOperations(db, deviceId, 10)).toEqual([]);
  });

  it("refuses on a client that is not a registered device", async () => {
    await expect(
      db.transaction((tx) => sink.record(tx, { action: "tenancy.clock.movedBack", userId: USER })),
    ).rejects.toThrow(/not a registered device/);
  });
});
