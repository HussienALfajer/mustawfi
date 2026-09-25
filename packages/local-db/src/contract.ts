import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { ALL_TABLES, type ChangedTables, type LocalDb, LocalDbError } from "./local-db.ts";
import { LocalMigrationMismatch, migrateLocalDb } from "./migrations.ts";
import { int64, localOrm, safeInteger } from "./orm.ts";

export interface ContractAdapter {
  /** Opens a fresh, empty database. */
  readonly open: () => Promise<LocalDb>;
  /** `PRAGMA journal_mode` the adapter's databases report: `wal` on a file. */
  readonly journalMode: string;
}

const counters = sqliteTable("contract_counters", {
  name: text().primaryKey(),
  value: safeInteger().notNull(),
  amount: int64().notNull(),
});

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function withDb(adapter: ContractAdapter, test: (db: LocalDb) => Promise<void>) {
  const db = await adapter.open();
  try {
    await test(db);
  } finally {
    await db.close();
  }
}

async function items(db: LocalDb): Promise<string[]> {
  return (await db.query("SELECT name FROM items ORDER BY name")).map((row) => String(row["name"]));
}

const ITEMS = "CREATE TABLE items (name TEXT PRIMARY KEY, qty INTEGER NOT NULL DEFAULT 0)";

/**
 * The `LocalDb` contract (ADR-0019): every adapter — Node, WASM, and the native ones — passes
 * the same cases.
 */
export function localDbContract(name: string, adapter: ContractAdapter): void {
  describe(`LocalDb contract: ${name}`, () => {
    it("reads every INTEGER as a bigint, beyond 2^53 too, and keeps the other types", async () => {
      await withDb(adapter, async (db) => {
        const [row] = await db.query(
          "SELECT ? AS big, ? AS small, -? AS negative, ? AS arabic, NULL AS empty, ? AS bytes, 1.5 AS real",
          [
            9_223_372_036_854_775_807n,
            1n,
            9_007_199_254_740_993n,
            "متجر ١٢",
            new Uint8Array([1, 2]),
          ],
        );
        expect(row).toEqual({
          big: 9_223_372_036_854_775_807n,
          small: 1n,
          negative: -9_007_199_254_740_993n,
          arabic: "متجر ١٢",
          empty: null,
          bytes: new Uint8Array([1, 2]),
          real: 1.5,
        });
      });
    });

    it("binds whole numbers as integers", async () => {
      await withDb(adapter, async (db) => {
        const [row] = await db.query("SELECT typeof(?) AS type, ? + 1 AS next", [5, 5]);
        expect(row).toEqual({ type: "integer", next: 6n });
        await db.run(ITEMS);
        await db.run("INSERT INTO items (name) VALUES ('a'), ('b'), ('c')");
        expect(await db.query("SELECT name FROM items ORDER BY name LIMIT ?", [2])).toHaveLength(2);
      });
    });

    it("gives rows as arrays in column order and counts changed rows", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        const inserted = await db.run("INSERT INTO items (name, qty) VALUES ('a', 1), ('b', 2)");
        expect(inserted.changes).toBe(2);
        const updated = await db.run("UPDATE items SET qty = qty + 1 WHERE name = 'z'");
        expect(updated.changes).toBe(0);
        const selected = await db.run("SELECT qty, name FROM items ORDER BY name");
        expect(selected.columns).toEqual(["qty", "name"]);
        expect(selected.rows).toEqual([
          [1n, "a"],
          [2n, "b"],
        ]);
        expect(selected.changes).toBe(0);
      });
    });

    it("commits every statement of a transaction together", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        const result = await db.transaction(async (tx) => {
          await tx.run("INSERT INTO items (name) VALUES ('a')");
          await tx.run("INSERT INTO items (name) VALUES ('b')");
          return (await tx.query("SELECT count(*) AS n FROM items"))[0]?.["n"];
        });
        expect(result).toBe(2n);
        expect(await items(db)).toEqual(["a", "b"]);
      });
    });

    it("rolls back every statement when the work throws, and rethrows its error", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        const failure = new Error("the sale failed half way");
        await expect(
          db.transaction(async (tx) => {
            await tx.run("INSERT INTO items (name) VALUES ('a')");
            await tx.run("UPDATE items SET qty = 5");
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await items(db)).toEqual([]);
        // The database is usable afterwards.
        await db.transaction((tx) => tx.run("INSERT INTO items (name) VALUES ('b')"));
        expect(await items(db)).toEqual(["b"]);
      });
    });

    it("rolls back when a statement fails, reporting a LocalDbError", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        await db.run("INSERT INTO items (name) VALUES ('a')");
        await expect(
          db.transaction(async (tx) => {
            await tx.run("INSERT INTO items (name) VALUES ('b')");
            await tx.run("INSERT INTO items (name) VALUES ('a')");
          }),
        ).rejects.toBeInstanceOf(LocalDbError);
        expect(await items(db)).toEqual(["a"]);
        await expect(db.query("SELECT * FROM missing")).rejects.toBeInstanceOf(LocalDbError);
      });
    });

    it("runs one transaction at a time; calls on the database wait for it", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        const gate = deferred();
        const order: string[] = [];
        const first = db.transaction(async (tx) => {
          await tx.run("INSERT INTO items (name) VALUES ('first')");
          order.push("first wrote");
          await gate.promise;
          await tx.run("UPDATE items SET qty = 1 WHERE name = 'first'");
          order.push("first done");
        });
        const second = db.transaction(async (tx) => {
          order.push("second began");
          const seen = await tx.query("SELECT qty FROM items WHERE name = 'first'");
          await tx.run("INSERT INTO items (name) VALUES ('second')");
          return seen;
        });
        const outside = db.query("SELECT name, qty FROM items ORDER BY name");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(order).toEqual(["first wrote"]);
        gate.release();
        await first;
        expect(await second).toEqual([{ qty: 1n }]);
        expect(order).toEqual(["first wrote", "first done", "second began"]);
        // Queued after both: it never saw the first transaction half done.
        expect(await outside).toEqual([
          { name: "first", qty: 1n },
          { name: "second", qty: 0n },
        ]);
      });
    });

    it("refuses a transaction's executor once the transaction has ended", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        let leaked: Parameters<Parameters<LocalDb["transaction"]>[0]>[0] | undefined;
        await db.transaction(async (tx) => {
          leaked = tx;
          await tx.run("INSERT INTO items (name) VALUES ('a')");
        });
        await expect(leaked?.run("INSERT INTO items (name) VALUES ('b')")).rejects.toThrow(
          /transaction has ended/,
        );
        expect(await items(db)).toEqual(["a"]);
      });
    });

    it("announces the changed tables after a commit, and nothing else", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        await db.run('CREATE TABLE "other items" (id INTEGER PRIMARY KEY)');
        const heard: ChangedTables[] = [];
        const unsubscribe = db.subscribe((tables) => heard.push(tables));

        await db.transaction(async (tx) => {
          await tx.run("INSERT INTO items (name) VALUES ('a')");
          await tx.run('INSERT INTO "other items" (id) VALUES (1)');
          expect(heard).toEqual([]);
        });
        expect(heard).toEqual([new Set(["items", "other items"])]);

        await db
          .transaction(async (tx) => {
            await tx.run("INSERT INTO items (name) VALUES ('b')");
            throw new Error("rolled back");
          })
          .catch(() => undefined);
        await db.query("SELECT * FROM items");
        await db.run("UPDATE items SET qty = 1 WHERE name = 'nobody'");
        expect(heard).toHaveLength(1);

        await db.run("UPDATE items SET qty = 2 WHERE name = 'a' RETURNING qty");
        await db.run("DELETE FROM items");
        await db.run("WITH x AS (SELECT 1) INSERT INTO items (name) SELECT 'c' FROM x");
        expect(heard.slice(1)).toEqual([
          new Set(["items"]),
          new Set(["items"]),
          new Set([ALL_TABLES]),
        ]);

        unsubscribe();
        await db.run("INSERT INTO items (name) VALUES ('d')");
        expect(heard).toHaveLength(4);
      });
    });

    it("keeps a committed transaction when a listener throws", async () => {
      await withDb(adapter, async (db) => {
        await db.run(ITEMS);
        const heard: ChangedTables[] = [];
        const errors: unknown[] = [];
        const onError = (error: unknown) => errors.push(error);
        process.on("uncaughtException", onError);
        try {
          db.subscribe(() => {
            throw new Error("listener failed");
          });
          db.subscribe((tables) => heard.push(tables));
          await db.transaction((tx) => tx.run("INSERT INTO items (name) VALUES ('a')"));
          await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
          process.off("uncaughtException", onError);
        }
        expect(await items(db)).toEqual(["a"]);
        expect(heard).toHaveLength(1);
        expect(errors).toHaveLength(1);
      });
    });

    it("opens with synchronous = FULL, foreign keys on, and the adapter's journal mode", async () => {
      await withDb(adapter, async (db) => {
        expect(await db.query("PRAGMA synchronous")).toEqual([{ synchronous: 2n }]);
        expect(await db.query("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1n }]);
        expect(await db.query("PRAGMA journal_mode")).toEqual([
          { journal_mode: adapter.journalMode },
        ]);
      });
    });

    it("applies migrations once, in order, and refuses a reordered list", async () => {
      await withDb(adapter, async (db) => {
        const first = { id: "a.0001_items", statements: [ITEMS] };
        const second = {
          id: "a.0002_index",
          statements: ["CREATE INDEX items_qty ON items (qty)"],
        };
        expect(await migrateLocalDb(db, [first])).toEqual({ applied: ["a.0001_items"] });
        expect(await migrateLocalDb(db, [first, second])).toEqual({ applied: ["a.0002_index"] });
        expect(await migrateLocalDb(db, [first, second])).toEqual({ applied: [] });
        await expect(migrateLocalDb(db, [second, first])).rejects.toBeInstanceOf(
          LocalMigrationMismatch,
        );
        // An older app, which knows fewer migrations, refuses a newer database.
        await expect(migrateLocalDb(db, [first])).rejects.toBeInstanceOf(LocalMigrationMismatch);
        // A failing migration leaves no trace, not even its ledger row.
        const broken = { id: "a.0003_broken", statements: [ITEMS, "not sql"] };
        await expect(migrateLocalDb(db, [first, second, broken])).rejects.toBeInstanceOf(
          LocalDbError,
        );
        expect(await db.query("SELECT id FROM local_migrations ORDER BY position")).toEqual([
          { id: "a.0001_items" },
          { id: "a.0002_index" },
        ]);
      });
    });

    it("calls beforeApplying once, only before migrating a database that has data", async () => {
      await withDb(adapter, async (db) => {
        const first = { id: "a.0001_items", statements: [ITEMS] };
        const second = {
          id: "a.0002_index",
          statements: ["CREATE INDEX items_qty ON items (qty)"],
        };
        const third = { id: "a.0003_other", statements: ["CREATE TABLE other (id TEXT)"] };
        const calls: (readonly string[])[] = [];
        const beforeApplying = async (pending: readonly string[]) => {
          calls.push(pending);
          // The hook sees the database as it was: nothing of the pending migrations yet.
          expect(await db.query("SELECT count(*) AS n FROM local_migrations")).toEqual([{ n: 1n }]);
        };
        // A new database has nothing to protect.
        await migrateLocalDb(db, [first], { beforeApplying });
        expect(calls).toEqual([]);
        await migrateLocalDb(db, [first, second, third], { beforeApplying });
        expect(calls).toEqual([["a.0002_index", "a.0003_other"]]);
        // Nothing pending, no call.
        await migrateLocalDb(db, [first, second, third], { beforeApplying });
        expect(calls).toHaveLength(1);
        // A failing hook stops the migration.
        const fourth = { id: "a.0004_more", statements: ["CREATE TABLE more (id TEXT)"] };
        const refused = new Error("no backup, no migration");
        await expect(
          migrateLocalDb(db, [first, second, third, fourth], {
            beforeApplying: () => Promise.reject(refused),
          }),
        ).rejects.toBe(refused);
        expect(await db.query("SELECT count(*) AS n FROM local_migrations")).toEqual([{ n: 3n }]);
      });
    });

    it("carries Drizzle queries, with int64 and safeInteger columns", async () => {
      await withDb(adapter, async (db) => {
        await db.run(
          "CREATE TABLE contract_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL, amount INTEGER NOT NULL) STRICT",
        );
        const heard: ChangedTables[] = [];
        db.subscribe((tables) => heard.push(tables));
        const inserted = await db.transaction((tx) =>
          localOrm(tx)
            .insert(counters)
            .values({ name: "INV", value: 1, amount: 12_345_678_901_234_567_890n / 10n })
            .onConflictDoUpdate({ target: counters.name, set: { value: 2 } })
            .returning(),
        );
        expect(inserted).toEqual([{ name: "INV", value: 1, amount: 1_234_567_890_123_456_789n }]);
        expect(heard).toEqual([new Set(["contract_counters"])]);
        const orm = localOrm(db);
        expect(await orm.select().from(counters).where(eq(counters.name, "INV")).get()).toEqual({
          name: "INV",
          value: 1,
          amount: 1_234_567_890_123_456_789n,
        });
        expect(
          await orm.select().from(counters).where(eq(counters.name, "none")).get(),
        ).toBeUndefined();
      });
    });

    it("finishes queued work, then refuses work once closing", async () => {
      const db = await adapter.open();
      const queued = db.query("SELECT 1 AS one");
      const closing = db.close();
      await expect(db.query("SELECT 1")).rejects.toThrow(/closed/);
      await expect(queued).resolves.toEqual([{ one: 1n }]);
      await closing;
      await expect(db.query("SELECT 1")).rejects.toBeInstanceOf(LocalDbError);
    });
  });
}
