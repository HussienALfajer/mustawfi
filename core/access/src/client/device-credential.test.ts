import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureApi, holdDeviceCredential } from "@mustawfi/core-config/client";
import { memorySecureStore, type SecureStore } from "@mustawfi/keystore";
import { manualClock } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { type NativeLocalDb, openNativeLocalDb } from "@mustawfi/local-db/native";
import { buildNativeHost, startNativeHost } from "@mustawfi/local-db/native-host";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accessLocalMigrations,
  DeviceCredentialMissing,
  deviceCredentialLocalMigrations,
  holdLocalDeviceCredential,
  localDevice,
  localDeviceCredential,
  moveDeviceCredentialToSecureStore,
  registerThisDevice,
  type RegisterThisDeviceInput,
} from "./device.ts";

/**
 * `core-foundation` slice 18 on the native core — the Rust SQLite the Windows app runs — so the
 * database files themselves can be searched for the credential.
 */
const directory = mkdtempSync(join(tmpdir(), "mustawfi-device-credential-"));
const hosts: ChildProcessWithoutNullStreams[] = [];
let binary = "";

const DEVICE = "0199a3c4-0000-7000-8000-00000000d001";
const TENANT = "0199a3c4-0000-7000-8000-0000000000a1";
/** Long and distinctive, so finding it in a file cannot be chance. */
const CREDENTIAL = "d1.c2xpY2UtMTgtb25seS1pbi10aGUtc2VjdXJlLXN0b3JlLW5vdC10aGUtZmlsZQ";
const clock = manualClock(new Date("2026-09-27T09:00:00.000Z"));

beforeAll(async () => {
  binary = await buildNativeHost();
}, 600_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  configureApi({ origin: "", session: "cookie" });
  holdDeviceCredential(undefined);
});

afterAll(() => {
  for (const host of hosts) host.kill();
  rmSync(directory, { recursive: true, force: true });
});

/** One run of the Windows app on the database `name`. */
async function open(name: string): Promise<NativeLocalDb> {
  const host = startNativeHost(binary, directory);
  hosts.push(host.process);
  return openNativeLocalDb(host.transport, name);
}

/** Whether the database file or its write-ahead log contains `text`. */
function filesHold(name: string, text: string): boolean {
  return ["", "-wal"].some((suffix) => {
    const file = join(directory, `${name}.sqlite3${suffix}`);
    return existsSync(file) && readFileSync(file).includes(Buffer.from(text, "utf8"));
  });
}

/** The copies of `name` in the backups directory, and whether any of them contains `text`. */
function copiesOf(name: string, text: string): { count: number; holding: number } {
  const backups = join(directory, "backups");
  const files = existsSync(backups)
    ? readdirSync(backups).filter((file) => file.startsWith(`${name}-`))
    : [];
  const needle = Buffer.from(text, "utf8");
  return {
    count: files.length,
    holding: files.filter((file) => readFileSync(join(backups, file)).includes(needle)).length,
  };
}

/** A device registered by a version that kept the credential in the database. */
async function registeredByEarlierVersion(db: LocalDb): Promise<void> {
  await migrateLocalDb(db, accessLocalMigrations);
  await db.run(
    `INSERT INTO access_device (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
     VALUES (?, ?, 'K7', 'الصندوق', 'mainPos', ?, 'SYP', ?)`,
    [DEVICE, TENANT, CREDENTIAL, clock.now().toISOString()],
  );
  // Some sales' worth of pages around it, as on a device that has been working.
  await db.run("CREATE TABLE filler (body TEXT NOT NULL)");
  for (let row = 0; row < 50; row += 1)
    await db.run("INSERT INTO filler VALUES (?)", ["x".repeat(900)]);
}

const MIGRATIONS = [...accessLocalMigrations, ...deviceCredentialLocalMigrations];

describe("the device credential moves to the OS secure store (ADR-0022)", () => {
  it("leaves no copy of an earlier version's credential in the database file, its log, or its copies", async () => {
    const native = await open("upgraded");
    const { db } = native;
    await registeredByEarlierVersion(db);
    // A daily copy, and the one taken before migrating: both hold the credential.
    await native.backup();
    await native.backup();
    // The test would prove nothing if the credential were not in the files to begin with.
    expect(filesHold("upgraded", CREDENTIAL)).toBe(true);
    expect(copiesOf("upgraded", CREDENTIAL)).toEqual({ count: 2, holding: 2 });

    await migrateLocalDb(db, MIGRATIONS);
    const store = memorySecureStore();
    expect(await moveDeviceCredentialToSecureStore(db, store, native)).toBe(true);
    // One copy is left, taken after the move.
    expect(copiesOf("upgraded", CREDENTIAL)).toEqual({ count: 1, holding: 0 });

    expect(await db.query("SELECT credential FROM access_device")).toEqual([{ credential: null }]);
    expect(JSON.parse(store.secrets.get("deviceCredential") ?? "")).toEqual({
      deviceId: DEVICE,
      credential: CREDENTIAL,
    });
    expect(filesHold("upgraded", CREDENTIAL)).toBe(false);
    expect(await localDeviceCredential(db, store)).toBe(CREDENTIAL);
    // Once moved, there is nothing left to move.
    expect(await moveDeviceCredentialToSecureStore(db, store)).toBe(false);
    await db.close();

    // The next run of the app finds it in the store.
    const { db: next } = await open("upgraded");
    expect((await localDevice(next))?.deviceId).toBe(DEVICE);
    expect(await localDeviceCredential(next, store)).toBe(CREDENTIAL);
    await next.close();
  });

  it("keeps the credential in the database when the store fails, and moves it at a later start", async () => {
    const { db } = await open("store-fails");
    await registeredByEarlierVersion(db);
    await migrateLocalDb(db, MIGRATIONS);
    const working = memorySecureStore();
    const failing: SecureStore = {
      ...working,
      set: () => Promise.reject(new Error("Credential Manager is not reachable")),
    };
    await expect(moveDeviceCredentialToSecureStore(db, failing)).rejects.toThrow();
    // A store that answers but does not hold what it was given is no better.
    const forgetful: SecureStore = { ...working, set: () => Promise.resolve() };
    await expect(moveDeviceCredentialToSecureStore(db, forgetful)).rejects.toThrow(
      "the secure store did not keep the device credential",
    );
    expect(await localDeviceCredential(db, failing)).toBe(CREDENTIAL);

    expect(await moveDeviceCredentialToSecureStore(db, working)).toBe(true);
    expect(await localDeviceCredential(db, working)).toBe(CREDENTIAL);
    await db.close();
  });

  it("keeps the old copies when no new one can be taken, so the device is never without one", async () => {
    const { db } = await open("no-copy");
    await registeredByEarlierVersion(db);
    await migrateLocalDb(db, MIGRATIONS);
    const removeBackups = vi.fn(() => Promise.resolve(0));
    const noCopy = { backup: () => Promise.resolve(undefined), removeBackups };
    await expect(
      moveDeviceCredentialToSecureStore(db, memorySecureStore(), noCopy),
    ).rejects.toThrow("no copy of the local database could be taken");
    expect(removeBackups).not.toHaveBeenCalled();
    // The credential itself has left the file all the same.
    expect(filesHold("no-copy", CREDENTIAL)).toBe(false);
    await db.close();
  });

  it("never writes a new registration's credential into the database file", async () => {
    const { db } = await open("registered");
    await migrateLocalDb(db, MIGRATIONS);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({
          deviceId: DEVICE,
          tenantId: TENANT,
          name: "الصندوق",
          prefix: "K7",
          credential: CREDENTIAL,
          baseCurrency: "SYP",
        }),
      ),
    );
    const store = memorySecureStore();
    const input: RegisterThisDeviceInput = {
      type: "mainPos",
      platform: "windows",
      storeCode: "AB2CD3",
      registrationCode: "R1",
      name: "الصندوق",
    };
    await registerThisDevice(db, input, clock, store);

    expect(await db.query("SELECT credential FROM access_device")).toEqual([{ credential: null }]);
    expect(filesHold("registered", CREDENTIAL)).toBe(false);
    expect(await localDeviceCredential(db, store)).toBe(CREDENTIAL);
    await db.close();
  });

  it("keeps a new registration in the database when the store fails, so it is not lost", async () => {
    const { db } = await open("registered-no-store");
    await migrateLocalDb(db, MIGRATIONS);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({
          deviceId: DEVICE,
          tenantId: TENANT,
          name: "الصندوق",
          prefix: "K7",
          credential: CREDENTIAL,
          baseCurrency: "SYP",
        }),
      ),
    );
    const failing: SecureStore = {
      ...memorySecureStore(),
      set: () => Promise.reject(new Error("Credential Manager is not reachable")),
    };
    const input: RegisterThisDeviceInput = {
      type: "mainPos",
      platform: "windows",
      storeCode: "AB2CD3",
      registrationCode: "R1",
      name: "الصندوق",
    };
    await registerThisDevice(db, input, clock, failing);
    expect(await localDeviceCredential(db, failing)).toBe(CREDENTIAL);
    // The browser has no store: its credential stays in the origin's private database.
    await db.close();
  });

  it("does not take a credential the store keeps for another device", async () => {
    const { db } = await open("stale");
    await registeredByEarlierVersion(db);
    await migrateLocalDb(db, MIGRATIONS);
    const store = memorySecureStore();
    await moveDeviceCredentialToSecureStore(db, store);
    // Left by an earlier registration of this Windows user, or damaged.
    for (const kept of [
      JSON.stringify({ deviceId: "0199a3c4-0000-7000-8000-00000000d002", credential: "d2.other" }),
      "not json",
    ]) {
      await store.set("deviceCredential", kept);
      await expect(localDeviceCredential(db, store)).rejects.toBeInstanceOf(
        DeviceCredentialMissing,
      );
    }
    await store.delete("deviceCredential");
    await expect(localDeviceCredential(db, store)).rejects.toBeInstanceOf(DeviceCredentialMissing);
    await expect(localDeviceCredential(db, undefined)).rejects.toBeInstanceOf(
      DeviceCredentialMissing,
    );

    // The app still starts: the device sells offline, and sync says what is missing.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureApi({ origin: "", session: "bearer", secureStore: store });
    await expect(holdLocalDeviceCredential(db)).resolves.toBeUndefined();
    await db.close();
  });
});
