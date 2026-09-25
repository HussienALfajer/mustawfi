import {
  createLocalDb,
  type LocalDb,
  LocalDbError,
  type SqliteConnection,
  type StatementResult,
} from "./local-db.ts";
import type { OpenedDurability, WorkerRequest, WorkerResponse } from "./worker-protocol.ts";

/** The local database could not be opened: no OPFS, or another tab of the app holds it. */
export class LocalDbUnavailable extends LocalDbError {
  override name = "LocalDbUnavailable";
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

/**
 * Opens the browser's local database (ADR-0019) in `worker`, which runs `serveLocalDbWorker`:
 * SQLite WASM on OPFS. Asks the browser to keep the storage (`navigator.storage.persist()`),
 * though the browser stays a limited offline client (ADR-0010).
 */
export async function openWorkerLocalDb(
  worker: Worker,
  name: string,
): Promise<{ db: LocalDb; durability: OpenedDurability }> {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  /** Set when the worker failed: every later request fails at once instead of waiting forever. */
  let failure: LocalDbError | undefined;
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.id);
    if (waiting === undefined) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new LocalDbError(response.message));
  });
  worker.addEventListener("error", (event) => {
    failure = new LocalDbError(`the local database worker failed: ${event.message}`);
    for (const waiting of pending.values()) waiting.reject(failure);
    pending.clear();
  });

  function send(request: Distribute<WorkerRequest>): Promise<unknown> {
    if (failure !== undefined) return Promise.reject(failure);
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id });
    });
  }

  await navigator.storage.persist().catch(() => false);
  let durability: OpenedDurability;
  try {
    durability = (await send({ kind: "open", name })) as OpenedDurability;
  } catch (error) {
    worker.terminate();
    throw new LocalDbUnavailable(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  const connection: SqliteConnection = {
    async run(sql, params) {
      return (await send({ kind: "run", sql, params })) as StatementResult;
    },
    async close() {
      await send({ kind: "close" });
      worker.terminate();
    },
  };
  return { db: createLocalDb(connection), durability };
}
