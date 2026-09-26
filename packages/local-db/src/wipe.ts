import type { LocalDb, LocalExecutor } from "./local-db.ts";
import { type LocalMigration, migrateLocalDb } from "./migrations.ts";

export interface WipeOptions {
  /** The app's local schema, applied again once everything is dropped. */
  readonly migrations: readonly LocalMigration[];
  /**
   * Checked in the wipe's own transaction, before anything is dropped: the wipe happens only if
   * it resolves to `true`, so nothing committed meanwhile is lost unseen.
   */
  readonly when?: (tx: LocalExecutor) => Promise<boolean>;
}

/**
 * Wipes the local database (a revoked device, `core-foundation` rule 23): drops every table in
 * one transaction — their rows, and the triggers that keep recorded documents from being
 * deleted, go with them — then applies `migrations` again, so the app starts over on an empty
 * schema as a device that is not registered. Resolves to whether it wiped. Should the app stop
 * between the two steps, its start-up migration builds the schema again.
 */
export async function wipeLocalDb(db: LocalDb, options: WipeOptions): Promise<boolean> {
  const dropped = await db.transaction(async (tx) => {
    if (options.when !== undefined && !(await options.when(tx))) return false;
    // A parent may go before its children: foreign keys are checked at commit, when none is left.
    await tx.run("PRAGMA defer_foreign_keys = ON");
    const tables = await tx.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    );
    for (const row of tables) {
      await tx.run(`DROP TABLE "${String(row["name"]).replaceAll('"', '""')}"`);
    }
    return true;
  });
  if (!dropped) return false;
  await migrateLocalDb(db, options.migrations);
  return true;
}

/**
 * Rewrites the database file without the space of dropped rows, and empties the write-ahead
 * log, so wiped rows cannot be read back from the file. Runs outside any transaction, after a
 * wipe.
 */
export async function compactLocalDb(db: LocalDb): Promise<void> {
  await db.run("VACUUM");
  await db.run("PRAGMA wal_checkpoint(TRUNCATE)");
}
