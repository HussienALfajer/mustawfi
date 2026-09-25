import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";

/**
 * `db:migrate`: applies every pending migration of the registered modules, as
 * `mustawfi_owner` (`DATABASE_OWNER_URL`), before a new server version starts (ADR-0016).
 */
const url = process.env["DATABASE_OWNER_URL"];
if (url === undefined || url === "") {
  process.stderr.write("DATABASE_OWNER_URL (mustawfi_owner) is not set\n");
  process.exitCode = 2;
} else {
  const applied = await applyMigrations(url, migrationSets);
  for (const { moduleId, tag } of applied) process.stdout.write(`applied ${moduleId} ${tag}\n`);
  process.stdout.write(`${applied.length} migration(s) applied\n`);
}
