import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  createLocalDb,
  DURABILITY_PRAGMAS,
  type LocalDb,
  LocalDbError,
  type LocalValue,
  type SqliteConnection,
  type StatementResult,
} from "./local-db.ts";

/**
 * The Node adapter (ADR-0019): `node:sqlite`, for unit tests and the sync simulation harness.
 * `path` is a file (WAL, `synchronous = FULL`) or `":memory:"`.
 */
export function openNodeLocalDb(path: string): LocalDb {
  const database = new DatabaseSync(path);
  const connection: SqliteConnection = {
    run(sql, params) {
      try {
        const statement = database.prepare(sql);
        statement.setReadBigInts(true);
        statement.setReturnArrays(true);
        const columns = statement.columns().map((column) => column.name);
        const values = params as SQLInputValue[];
        if (columns.length > 0) {
          const rows = statement.all(...values) as unknown as LocalValue[][];
          return Promise.resolve({ columns, rows, changes: 0 } satisfies StatementResult);
        }
        const { changes } = statement.run(...values);
        return Promise.resolve({ columns, rows: [], changes: Number(changes) });
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
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
  for (const pragma of DURABILITY_PRAGMAS) database.exec(pragma);
  return createLocalDb(connection);
}
