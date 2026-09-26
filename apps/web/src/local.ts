import { holdLocalDeviceCredential } from "@mustawfi/core-access/client";
import { organizationPullAppliers } from "@mustawfi/core-organization/client";
import { createSyncEngine, type SyncEngine } from "@mustawfi/core-sync/client";
import { inventoryPullAppliers } from "@mustawfi/inventory/client";
import { systemClock } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb, touchesLocalTables } from "@mustawfi/local-db";
import type { QueryClient } from "@tanstack/react-query";
import { bundleVerifier } from "./bundle-verifier.ts";
import { LOCAL_MIGRATIONS } from "./local-migrations.ts";
import type { ClientPlatform } from "./platform.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface LocalRuntime {
  readonly db: LocalDb;
  readonly sync: SyncEngine;
}

/**
 * Opens the device's local database, migrates it before the outbox is used, and starts the
 * sync loop. Commits invalidate the queries that read the changed tables (ADR-0023).
 *
 * Where the platform can copy the database (the Windows app), it does so before migrating a
 * database that has data, and once a day (ADR-0019): at start-up, then checked every hour.
 */
export async function startLocalRuntime(
  queryClient: QueryClient,
  platform: ClientPlatform,
): Promise<LocalRuntime> {
  const { db, backup, removeBackups } = await platform.openLocalDb();
  await migrateLocalDb(db, LOCAL_MIGRATIONS, {
    ...(backup === undefined
      ? {}
      : {
          beforeApplying: async () => {
            if ((await backup()) === undefined) {
              throw new Error("the local database could not be copied before migrating");
            }
          },
        }),
  });
  // A session opened on this device is accepted only with its credential (rule 22).
  await holdLocalDeviceCredential(db);
  if (backup !== undefined) {
    const daily = () => {
      // A missed daily copy must not stop the till; the next check tries again.
      backup({ minAgeMs: DAY_MS }).catch((error: unknown) => {
        console.error("the daily copy of the local database failed", error);
      });
    };
    daily();
    setInterval(daily, HOUR_MS);
  }
  db.subscribe((tables) => {
    void queryClient.invalidateQueries({
      predicate: (query) => touchesLocalTables(query.meta, tables),
    });
  });
  const sync = createSyncEngine({
    db,
    migrations: LOCAL_MIGRATIONS,
    appliers: [...organizationPullAppliers, ...inventoryPullAppliers],
    clock: systemClock,
    // The configuration bundle, fetched after each round and verified (`core-foundation` rule 11).
    bundle: bundleVerifier(),
    // A revoked device's wipe deletes the database copies too (`core-foundation` rule 23).
    ...(removeBackups === undefined ? {} : { onWiped: removeBackups }),
  });
  // A round on each change of connectivity: "offline" shows at once, "online" sends the outbox.
  window.addEventListener("online", () => void sync.syncNow());
  window.addEventListener("offline", () => void sync.syncNow());
  sync.start();
  return { db, sync };
}
