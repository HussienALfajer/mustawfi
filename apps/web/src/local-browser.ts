import type { LocalDb } from "@mustawfi/local-db";
import { openWorkerLocalDb } from "@mustawfi/local-db/browser";

/** The browser's local database: SQLite WASM on OPFS in a dedicated worker (ADR-0019). */
export async function openBrowserLocalDb(name: string): Promise<LocalDb> {
  const worker = new Worker(new URL("./local-db.worker.ts", import.meta.url), { type: "module" });
  const { db, durability } = await openWorkerLocalDb(worker, name);
  if (durability.journalMode !== "wal" || durability.synchronous !== "2") {
    console.warn("the local database is not in WAL with synchronous = FULL", durability);
  }
  return db;
}
