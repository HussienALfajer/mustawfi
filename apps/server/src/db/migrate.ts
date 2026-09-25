import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/** One module's migrations: the folder `drizzle-kit generate` writes (ADR-0016). */
export interface MigrationSet {
  readonly moduleId: string;
  readonly dir: string;
}

export interface Migration {
  readonly tag: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly moduleId: string;
  readonly tag: string;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

/** Serializes concurrent runs (two deploys, two test workers) on one database. */
const ADVISORY_LOCK_KEY = 7_016_017;

interface Journal {
  entries: { idx: number; tag: string }[];
}

/**
 * Reads a set in journal order. Line endings are normalized first so a checkout with CRLF
 * files has the same checksums as one with LF files.
 */
export async function readMigrations(set: MigrationSet): Promise<Migration[]> {
  const journal = JSON.parse(
    await readFile(join(set.dir, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return Promise.all(
    entries.map(async (entry, position) => {
      if (entry.idx !== position) {
        throw new MigrationError(`${set.moduleId}: journal index ${entry.idx} is out of sequence`);
      }
      const sql = (await readFile(join(set.dir, `${entry.tag}.sql`), "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      return { tag: entry.tag, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

function pendingMigrations(
  set: MigrationSet,
  migrations: Migration[],
  applied: { tag: string; checksum: string }[],
): Migration[] {
  applied.forEach((done, position) => {
    const migration = migrations[position];
    if (migration === undefined || migration.tag !== done.tag) {
      throw new MigrationError(
        `${set.moduleId}: applied migration ${done.tag} is not at position ${position} of the journal; ` +
          "migrations are forward-only — never remove or reorder a merged migration",
      );
    }
    if (migration.checksum !== done.checksum) {
      throw new MigrationError(
        `${set.moduleId}: migration ${done.tag} changed after it was applied; ` +
          "migrations are forward-only — add a new migration instead",
      );
    }
  });
  return migrations.slice(applied.length);
}

/**
 * Applies every pending migration, set by set in the given order — a module's sets come after
 * those of the modules it depends on. Runs as `mustawfi_owner`, so the owner owns what the
 * migrations create; each migration commits in its own transaction with its bookkeeping row.
 */
export async function applyMigrations(
  connectionString: string,
  sets: readonly MigrationSet[],
): Promise<AppliedMigration[]> {
  const moduleIds = sets.map((s) => s.moduleId);
  if (new Set(moduleIds).size !== moduleIds.length) {
    throw new MigrationError(
      `a module appears twice in the migration sets: ${moduleIds.join(", ")}`,
    );
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ rolsuper: boolean }>(
      "select rolsuper from pg_roles where rolname = current_user",
    );
    if (rows[0]?.rolsuper !== false) {
      throw new MigrationError(
        "migrations run as mustawfi_owner, never as a superuser, so the owner owns every object",
      );
    }

    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    let failed = false;
    try {
      await client.query(`
        create schema if not exists mustawfi_migrations;
        create table if not exists mustawfi_migrations.applied (
          module_id text not null,
          position integer not null,
          tag text not null,
          checksum text not null,
          applied_at timestamptz not null default now(),
          primary key (module_id, position),
          unique (module_id, tag)
        );`);

      const done: AppliedMigration[] = [];
      for (const set of sets) {
        const migrations = await readMigrations(set);
        const applied = await client.query<{ tag: string; checksum: string }>(
          "select tag, checksum from mustawfi_migrations.applied where module_id = $1 order by position",
          [set.moduleId],
        );
        const pending = pendingMigrations(set, migrations, applied.rows);
        let position = applied.rows.length;
        for (const migration of pending) {
          await client.query("begin");
          try {
            await client.query(migration.sql);
            await client.query(
              "insert into mustawfi_migrations.applied (module_id, position, tag, checksum) values ($1, $2, $3, $4)",
              [set.moduleId, position, migration.tag, migration.checksum],
            );
            await client.query("commit");
          } catch (error) {
            // A lost connection makes rollback fail too; report the migration, not the rollback.
            await client.query("rollback").catch(() => undefined);
            throw new MigrationError(`${set.moduleId}: migration ${migration.tag} failed`, {
              cause: error,
            });
          }
          done.push({ moduleId: set.moduleId, tag: migration.tag });
          position += 1;
        }
      }
      return done;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // After a failure the lock goes with the connection; an unlock error must not hide the cause.
      if (!failed) await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
