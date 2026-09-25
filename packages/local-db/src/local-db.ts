/**
 * A value SQLite stores and returns (ADR-0019). Every `INTEGER` comes back as a `bigint`, so a
 * scaled amount (ADR-0018) never passes through a JavaScript `number`; `REAL` comes back as a
 * `number` and has no place in money columns.
 */
export type LocalValue = string | bigint | number | null | Uint8Array;

export type LocalRow = Readonly<Record<string, LocalValue>>;

/** What one statement returned: its columns, its rows in column order, and rows changed. */
export interface StatementResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly LocalValue[])[];
  readonly changes: number;
}

/** Runs statements; inside `LocalDb.transaction` it is the transaction's own executor. */
export interface LocalExecutor {
  /** Rows as objects keyed by column name. */
  query(sql: string, params?: readonly LocalValue[]): Promise<LocalRow[]>;
  /** The full result, rows as arrays in column order (what Drizzle's proxy driver reads). */
  run(sql: string, params?: readonly LocalValue[]): Promise<StatementResult>;
}

/** The tables a committed change wrote; `ALL_TABLES` when a write could not be attributed. */
export type ChangedTables = ReadonlySet<string>;

export const ALL_TABLES = "*";

export type ChangeListener = (tables: ChangedTables) => void;

/**
 * The client's local database (ADR-0019): one interface over native SQLite (Windows, Android),
 * SQLite WASM on OPFS (browser), and `node:sqlite` (tests and the sync harness).
 *
 * - Statements run one at a time. `transaction(work)` runs `work` alone, between
 *   `BEGIN IMMEDIATE` and `COMMIT`, and rolls everything back if `work` throws. Calls on the
 *   database itself wait until an open transaction ends — inside `work`, use the executor it
 *   receives, never the database.
 * - After a commit, listeners hear which tables changed; a rollback or a read tells nobody.
 */
export interface LocalDb extends LocalExecutor {
  transaction<T>(work: (tx: LocalExecutor) => Promise<T>): Promise<T>;
  /** Calls `listener` after every commit that changed rows. Returns the unsubscribe. */
  subscribe(listener: ChangeListener): () => void;
  close(): Promise<void>;
}

/** The connection an adapter provides: runs one statement at a time, no queueing of its own. */
export interface SqliteConnection {
  run(sql: string, params: readonly LocalValue[]): Promise<StatementResult>;
  close(): Promise<void>;
}

/** An error SQLite raised, with the statement that raised it. */
export class LocalDbError extends Error {
  override name = "LocalDbError";
}

const WRITE_TARGET =
  /^\s*(?:insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([\w$]+))/i;
const WRITE_VERB = /^\s*(?:insert|replace|update|delete|with)\b/i;

/**
 * The table a data-changing statement writes, `ALL_TABLES` for one it cannot name (a `WITH`
 * before the verb), and `undefined` for everything else.
 */
export function writtenTable(sql: string): string | undefined {
  const match = WRITE_TARGET.exec(sql);
  if (match !== null) return match[1] ?? match[2] ?? match[3] ?? match[4];
  return WRITE_VERB.test(sql) ? ALL_TABLES : undefined;
}

function toRows(result: StatementResult): LocalRow[] {
  return result.rows.map((values) => {
    const row: Record<string, LocalValue> = {};
    result.columns.forEach((column, index) => {
      row[column] = values[index] ?? null;
    });
    return row;
  });
}

/**
 * The part of `LocalDb` every adapter shares: one statement or transaction at a time, commits
 * announced to listeners. The adapter supplies only the connection.
 */
export function createLocalDb(connection: SqliteConnection): LocalDb {
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const listeners = new Set<ChangeListener>();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new LocalDbError("the local database is closed"));
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  function announce(tables: Set<string>): void {
    if (tables.size === 0) return;
    const changed: ChangedTables = tables.has(ALL_TABLES) ? new Set([ALL_TABLES]) : tables;
    for (const listener of listeners) {
      try {
        listener(changed);
      } catch (error) {
        // A failing listener must not undo a committed sale or starve the other listeners.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  async function runTracked(
    sql: string,
    params: readonly LocalValue[],
    written: Set<string>,
  ): Promise<StatementResult> {
    // Whole numbers bind as integers on every adapter (Node binds any `number` as a double).
    const bound = params.map((value) =>
      typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : value,
    );
    const result = await connection.run(sql, bound);
    // A write with `RETURNING` reports its rows; adapters may not count its changes.
    const wrote = result.changes > 0 || result.rows.length > 0;
    const table = wrote ? writtenTable(sql) : undefined;
    if (table !== undefined) written.add(table);
    return result;
  }

  async function runAlone(sql: string, params: readonly LocalValue[]): Promise<StatementResult> {
    return exclusive(async () => {
      const written = new Set<string>();
      const result = await runTracked(sql, params, written);
      announce(written);
      return result;
    });
  }

  return {
    async query(sql, params = []) {
      return toRows(await runAlone(sql, params));
    },
    run(sql, params = []) {
      return runAlone(sql, params);
    },
    transaction(work) {
      return exclusive(async () => {
        const written = new Set<string>();
        let open = true;
        const guard = () => {
          if (!open) throw new LocalDbError("the transaction has ended");
        };
        const tx: LocalExecutor = {
          async query(sql, params = []) {
            guard();
            return toRows(await runTracked(sql, params, written));
          },
          async run(sql, params = []) {
            guard();
            return runTracked(sql, params, written);
          },
        };
        await connection.run("BEGIN IMMEDIATE", []);
        let result;
        try {
          result = await work(tx);
        } catch (error) {
          open = false;
          // SQLite may have rolled back already (some errors end the transaction themselves).
          await connection.run("ROLLBACK", []).catch(() => undefined);
          throw error;
        }
        open = false;
        try {
          await connection.run("COMMIT", []);
        } catch (error) {
          // A failed COMMIT can leave the transaction open; end it so the next one can begin.
          await connection.run("ROLLBACK", []).catch(() => undefined);
          throw error;
        }
        announce(written);
        return result;
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      // After what is already queued; anything called from now on is refused at once.
      const closing = exclusive(() => connection.close());
      closed = true;
      listeners.clear();
      await closing;
    },
  };
}

/** The durability every adapter sets up (ADR-0019), applied as the connection opens. */
export const DURABILITY_PRAGMAS = [
  "PRAGMA synchronous = FULL",
  "PRAGMA foreign_keys = ON",
] as const;
