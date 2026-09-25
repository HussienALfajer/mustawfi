import type { Database } from "@sqlite.org/sqlite-wasm";
import type { SqliteConnection } from "./local-db.ts";
import { applyDurability, loadSqliteWasm, wasmConnection } from "./wasm.ts";
import type { OpenedDurability, WorkerRequest, WorkerResponse } from "./worker-protocol.ts";

/** The worker's side of `postMessage`, without the `webworker` lib (it clashes with `dom`). */
interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

function pragmaText(database: Database, name: string): string {
  const value = database.selectValue(`PRAGMA ${name}`);
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? value.toString()
    : "";
}

async function openOnOpfs(name: string): Promise<{
  connection: SqliteConnection;
  durability: OpenedDurability;
}> {
  const sqlite3 = await loadSqliteWasm();
  // The SAH pool VFS needs no cross-origin isolation; it holds its files exclusively, so a
  // second tab of the app cannot open the same database (ADR-0010: the browser is limited).
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "mustawfi-sahpool" });
  const database: Database = new pool.OpfsSAHPoolDb(`/${name}.sqlite3`);
  applyDurability(database, "wal");
  const durability: OpenedDurability = {
    journalMode: pragmaText(database, "journal_mode"),
    synchronous: pragmaText(database, "synchronous"),
  };
  return { connection: wasmConnection(sqlite3, database), durability };
}

/**
 * Serves the local database from a dedicated worker (ADR-0019): SQLite WASM on the origin
 * private file system. The page talks to it through `openWorkerLocalDb`, which keeps the
 * `LocalDb` guarantees (one statement or transaction at a time) on its side.
 */
export function serveLocalDbWorker(scope: WorkerScope = globalThis) {
  let connection: SqliteConnection | undefined;
  // Requests are answered in arrival order; the page's `LocalDb` sends one at a time anyway.
  let queue: Promise<void> = Promise.resolve();

  async function handle(request: WorkerRequest): Promise<WorkerResponse> {
    try {
      switch (request.kind) {
        case "open": {
          if (connection !== undefined) throw new Error("the local database is already open");
          const opened = await openOnOpfs(request.name);
          connection = opened.connection;
          return { id: request.id, ok: true, result: opened.durability };
        }
        case "run": {
          if (connection === undefined) throw new Error("the local database is not open");
          const result = await connection.run(request.sql, request.params);
          return { id: request.id, ok: true, result };
        }
        case "close": {
          await connection?.close();
          connection = undefined;
          return { id: request.id, ok: true };
        }
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      return { id: request.id, ok: false, message: failure.message, name: failure.name };
    }
  }

  scope.addEventListener("message", (event) => {
    const request = event.data;
    queue = queue.then(async () => {
      scope.postMessage(await handle(request));
    });
  });
}
