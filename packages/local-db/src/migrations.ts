import type { LocalDb } from "./local-db.ts";

/**
 * One step of a module's local schema (ADR-0019): declared in its `client` entry, shipped with
 * the app, applied at start-up. `id` is `<module>.<nnnn>_<name>` and never changes once shipped;
 * a change is a new migration.
 */
export interface LocalMigration {
  readonly id: string;
  readonly statements: readonly string[];
}

const LEDGER = `CREATE TABLE IF NOT EXISTS local_migrations (
  position INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE
) STRICT`;

/** A shipped migration was removed, renamed, or reordered: the app and the database disagree. */
export class LocalMigrationMismatch extends Error {
  override name = "LocalMigrationMismatch";
}

/**
 * Applies `migrations` in order, each in its own transaction with its ledger row, before the
 * outbox is opened. Already applied ones must be the list's prefix, in the same order.
 * Backups before a migration (`VACUUM INTO`) come with the desktop shell.
 */
export async function migrateLocalDb(
  db: LocalDb,
  migrations: readonly LocalMigration[],
): Promise<{ applied: string[] }> {
  const ids = new Set<string>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) throw new LocalMigrationMismatch(`${migration.id} is listed twice`);
    ids.add(migration.id);
  }
  await db.run(LEDGER);
  const done = (await db.query("SELECT id FROM local_migrations ORDER BY position")).map((row) =>
    String(row["id"]),
  );
  done.forEach((id, index) => {
    if (migrations[index]?.id !== id) {
      throw new LocalMigrationMismatch(
        `the database has ${id} at position ${String(index + 1)}; the app lists ${migrations[index]?.id ?? "nothing"}`,
      );
    }
  });
  const applied: string[] = [];
  for (const [index, migration] of migrations.entries()) {
    if (index < done.length) continue;
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.run(statement);
      await tx.run("INSERT INTO local_migrations (position, id) VALUES (?, ?)", [
        BigInt(index + 1),
        migration.id,
      ]);
    });
    applied.push(migration.id);
  }
  return { applied };
}
