import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  createLocalDb,
  DURABILITY_PRAGMAS,
  type LocalDb,
  LocalDbError,
  type LocalValue,
  type SqliteConnection,
  type StatementResult,
} from "./local-db.ts";

let sqlite: Promise<Sqlite3Static> | undefined;

/** The SQLite WASM module, loaded once per realm. */
export function loadSqliteWasm(): Promise<Sqlite3Static> {
  sqlite ??= sqlite3InitModule();
  return sqlite;
}

/**
 * Runs one statement on an open SQLite WASM database, reading every `INTEGER` as a `bigint`
 * through the C API (the object API turns safe integers into numbers).
 */
function runStatement(
  sqlite3: Sqlite3Static,
  database: Database,
  sql: string,
  params: readonly LocalValue[],
): StatementResult {
  const { capi } = sqlite3;
  const before = database.changes(true, true);
  const statement = database.prepare(sql);
  try {
    if (params.length > 0) statement.bind(params as LocalValue[]);
    const columns = statement.columnCount === 0 ? [] : statement.getColumnNames();
    const rows: LocalValue[][] = [];
    while (statement.step()) {
      const row: LocalValue[] = [];
      for (let index = 0; index < columns.length; index += 1) {
        const type = capi.sqlite3_column_type(statement.pointer ?? 0, index);
        row.push(
          type === capi.SQLITE_INTEGER
            ? BigInt(capi.sqlite3_column_int64(statement.pointer ?? 0, index))
            : (statement.get(index) as LocalValue),
        );
      }
      rows.push(row);
    }
    const changes = Number(database.changes(true, true) - before);
    return { columns, rows, changes };
  } finally {
    statement.finalize();
  }
}

/**
 * A connection over an SQLite WASM database already open in this realm: in a worker on OPFS
 * in the browser (`./worker`), or in memory under Node for the contract suite.
 */
export function wasmConnection(sqlite3: Sqlite3Static, database: Database): SqliteConnection {
  return {
    run(sql, params) {
      try {
        return Promise.resolve(runStatement(sqlite3, database, sql, params));
      } catch (error) {
        return Promise.reject(
          new LocalDbError(error instanceof Error ? error.message : String(error), {
            cause: error,
          }),
        );
      }
    },
    close() {
      database.close();
      return Promise.resolve();
    },
  };
}

/** Applies the durability pragmas; `journalMode` is what the VFS is asked for. */
export function applyDurability(database: Database, journalMode: "wal" | undefined): void {
  if (journalMode === "wal") {
    // Exclusive locking lets WAL work without shared memory, which OPFS does not have.
    database.exec("PRAGMA locking_mode = EXCLUSIVE");
    database.exec("PRAGMA journal_mode = WAL");
  }
  for (const pragma of DURABILITY_PRAGMAS) database.exec(pragma);
}

/** SQLite WASM in memory, in this realm: the WASM adapter as the contract suite runs it. */
export async function openWasmMemoryLocalDb(): Promise<LocalDb> {
  const sqlite3 = await loadSqliteWasm();
  const database = new sqlite3.oo1.DB(":memory:", "c");
  applyDurability(database, undefined);
  return createLocalDb(wasmConnection(sqlite3, database));
}
