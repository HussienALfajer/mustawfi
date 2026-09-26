import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDbContract } from "./contract.ts";
import { LocalDbError } from "./local-db.ts";
import {
  decodeWireValue,
  encodeWireValue,
  LOCAL_BACKUPS_KEPT,
  type NativeTransport,
  openNativeLocalDb,
} from "./native.ts";
import { buildNativeHost, startNativeHost } from "./native-host.ts";

/**
 * The native adapter against the real Rust core (`packages/local-db/native`), built here and
 * served over stdin/stdout by its `local-db-stdio` host (`native-host.ts`).
 */
const directory = mkdtempSync(join(tmpdir(), "mustawfi-native-db-"));
const hosts: ChildProcessWithoutNullStreams[] = [];
let binary = "";

beforeAll(async () => {
  binary = await buildNativeHost();
}, 600_000);

afterAll(() => {
  for (const host of hosts) host.kill();
  rmSync(directory, { recursive: true, force: true });
});

/** A new host process: one native session, like one run of the Windows app. */
function startHost(): NativeTransport {
  const host = startNativeHost(binary, directory);
  hosts.push(host.process);
  return host.transport;
}

let opened = 0;

localDbContract("native (Rust, rusqlite), on a file", {
  open: async () => {
    opened += 1;
    return (await openNativeLocalDb(startHost(), `contract-${String(opened)}`)).db;
  },
  journalMode: "wal",
});

describe("native adapter", () => {
  it("carries every value exactly across the wire", () => {
    const values = [
      -9_223_372_036_854_775_808n,
      0.1,
      Infinity,
      -Infinity,
      "متجر",
      new Uint8Array([0, 255]),
      null,
    ];
    expect(values.map((value) => decodeWireValue(encodeWireValue(value)))).toEqual(values);
    expect(Number.isNaN(decodeWireValue(encodeWireValue(NaN)))).toBe(true);
  });

  it("rolls back a transaction a reloaded page left open, when the page opens again", async () => {
    const transport = startHost();
    const first = await openNativeLocalDb(transport, "reload");
    await first.db.run("CREATE TABLE items (name TEXT)");
    // The page dies half way through a sale: BEGIN and a write reached the native side.
    await transport({ kind: "run", sql: "BEGIN IMMEDIATE", params: [] });
    await transport({ kind: "run", sql: "INSERT INTO items VALUES ('half a sale')", params: [] });
    const second = await openNativeLocalDb(transport, "reload");
    expect(await second.db.query("SELECT name FROM items")).toEqual([]);
    await second.db.transaction((tx) => tx.run("INSERT INTO items VALUES ('next sale')"));
    await second.db.close();
  });

  it("keeps a committed sale in the file for the next run of the app", async () => {
    const run1 = await openNativeLocalDb(startHost(), "durable");
    await run1.db.run("CREATE TABLE items (name TEXT)");
    await run1.db.transaction((tx) => tx.run("INSERT INTO items VALUES ('sold')"));
    // No close: the process is killed, as by a power cut; the next run starts once it is gone.
    const killed = hosts.at(-1);
    const exited = new Promise((resolveExit) => killed?.once("exit", resolveExit));
    killed?.kill("SIGKILL");
    await exited;
    const run2 = await openNativeLocalDb(startHost(), "durable");
    expect(await run2.db.query("SELECT name FROM items")).toEqual([{ name: "sold" }]);
    await run2.db.close();
  });

  it("refuses a database name that could leave its directory", async () => {
    await expect(openNativeLocalDb(startHost(), "../outside")).rejects.toBeInstanceOf(LocalDbError);
  });

  it("copies the database with VACUUM INTO, keeping the newest copies", async () => {
    const native = await openNativeLocalDb(startHost(), "backed");
    await native.db.run("CREATE TABLE items (name TEXT)");
    await native.db.run("INSERT INTO items VALUES ('sold')");
    const file = await native.backup();
    expect(file).toMatch(/^backed-\d+\.sqlite3$/);
    const copy = new DatabaseSync(join(directory, "backups", String(file)), { readOnly: true });
    expect(copy.prepare("SELECT name FROM items").all()).toEqual([{ name: "sold" }]);
    copy.close();

    // Once a day: a copy younger than the minimum age is enough.
    expect(await native.backup({ minAgeMs: 86_400_000 })).toBeUndefined();

    for (let taken = 1; taken <= LOCAL_BACKUPS_KEPT + 2; taken += 1) await native.backup();
    const kept = readdirSync(join(directory, "backups")).filter((name) =>
      name.startsWith("backed-"),
    );
    expect(kept).toHaveLength(LOCAL_BACKUPS_KEPT);
    expect(kept).not.toContain(file);
    await native.db.close();
  });

  it("deletes every backup of the database, and only its own", async () => {
    const other = await openNativeLocalDb(startHost(), "kept");
    await other.db.run("CREATE TABLE items (name TEXT)");
    const kept = await other.backup();
    await other.db.close();
    const native = await openNativeLocalDb(startHost(), "wiped");
    await native.db.run("CREATE TABLE items (name TEXT)");
    await native.backup();
    await native.backup();
    expect(await native.removeBackups()).toBe(2);
    const left = readdirSync(join(directory, "backups"));
    expect(left.filter((name) => name.startsWith("wiped-"))).toEqual([]);
    expect(left).toContain(kept);
    expect(await native.removeBackups()).toBe(0);
    await native.db.close();
  });

  it("skips a backup while a transaction is open", async () => {
    const native = await openNativeLocalDb(startHost(), "busy");
    await native.db.run("CREATE TABLE items (name TEXT)");
    const backedUp = await native.db.transaction(async (tx) => {
      await tx.run("INSERT INTO items VALUES ('sold')");
      return native.backup();
    });
    expect(backedUp).toBeUndefined();
    expect(await native.backup()).toMatch(/^busy-\d+\.sqlite3$/);
    await native.db.close();
  });
});
