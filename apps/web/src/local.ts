import { accessLocalMigrations } from "@mustawfi/core-access/client";
import { createSyncEngine, type SyncEngine, syncLocalMigrations } from "@mustawfi/core-sync/client";
import { inventoryLocalMigrations, inventoryPullAppliers } from "@mustawfi/inventory/client";
import { systemClock } from "@mustawfi/kernel";
import { salesLocalMigrations } from "@mustawfi/sales/client";
import { type LocalDb, migrateLocalDb, touchesLocalTables } from "@mustawfi/local-db";
import { openWorkerLocalDb } from "@mustawfi/local-db/browser";
import type { QueryClient } from "@tanstack/react-query";

/** Every module's local schema, in dependency order (ADR-0019). */
const LOCAL_MIGRATIONS = [
  ...accessLocalMigrations,
  ...syncLocalMigrations,
  ...inventoryLocalMigrations,
  ...salesLocalMigrations,
];

export interface LocalRuntime {
  readonly db: LocalDb;
  readonly sync: SyncEngine;
}

/**
 * Opens the device's local database, migrates it before the outbox is used, and starts the
 * sync loop. Commits invalidate the queries that read the changed tables (ADR-0023).
 */
export async function startLocalRuntime(queryClient: QueryClient): Promise<LocalRuntime> {
  const worker = new Worker(new URL("./local-db.worker.ts", import.meta.url), { type: "module" });
  const { db, durability } = await openWorkerLocalDb(worker, "mustawfi");
  if (durability.journalMode !== "wal" || durability.synchronous !== "2") {
    console.warn("the local database is not in WAL with synchronous = FULL", durability);
  }
  await migrateLocalDb(db, LOCAL_MIGRATIONS);
  db.subscribe((tables) => {
    void queryClient.invalidateQueries({
      predicate: (query) => touchesLocalTables(query.meta, tables),
    });
  });
  const sync = createSyncEngine({
    db,
    appliers: [...inventoryPullAppliers],
    clock: systemClock,
  });
  // A round on each change of connectivity: "offline" shows at once, "online" sends the outbox.
  window.addEventListener("online", () => void sync.syncNow());
  window.addEventListener("offline", () => void sync.syncNow());
  sync.start();
  return { db, sync };
}
