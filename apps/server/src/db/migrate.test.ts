import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "@mustawfi/testing";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, MigrationError, readMigrations, type MigrationSet } from "./migrate.ts";
import { rlsFixtureMigrations } from "./test-fixtures/index.ts";

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mustawfi-migrations-"));
  temporaryDirs.push(dir);
  return dir;
}

/** A migration set on disk in drizzle-kit's layout. */
function writeSet(moduleId: string, migrations: { tag: string; sql: string }[]): MigrationSet {
  const dir = temporaryDir();
  mkdirSync(join(dir, "meta"));
  const entries = migrations.map((m, idx) => ({ idx, version: "7", when: idx, tag: m.tag }));
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", entries }));
  for (const m of migrations) writeFileSync(join(dir, `${m.tag}.sql`), m.sql);
  return { moduleId, dir };
}

function copyOfFixture(): MigrationSet {
  const dir = temporaryDir();
  cpSync(rlsFixtureMigrations.dir, dir, { recursive: true });
  return { moduleId: rlsFixtureMigrations.moduleId, dir };
}

describe("applyMigrations", () => {
  it("applies each migration once, as the owner, and records it", async () => {
    const database = await createTestDatabase("migrate_apply");

    expect(await applyMigrations(database.url("owner"), [rlsFixtureMigrations])).toEqual([
      { moduleId: "test.rls-fixture", tag: "0000_items" },
      { moduleId: "test.rls-fixture", tag: "0001_items_rls" },
    ]);
    expect(await applyMigrations(database.url("owner"), [rlsFixtureMigrations])).toEqual([]);

    const superuser = await database.connect("superuser");
    try {
      const owners = await superuser.query<{ owner: string }>(
        `select distinct pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('rls_fixture', 'mustawfi_migrations')`,
      );
      expect(owners.rows).toEqual([{ owner: "mustawfi_owner" }]);
      const applied = await superuser.query<{ tag: string }>(
        "select tag from mustawfi_migrations.applied order by position",
      );
      expect(applied.rows.map((r) => r.tag)).toEqual(["0000_items", "0001_items_rls"]);
    } finally {
      await superuser.end();
    }
  });

  it("applies only the migrations added since the last run", async () => {
    const database = await createTestDatabase("migrate_append");
    const first = { tag: "0000_a", sql: "create schema appended; create table appended.a ();" };
    const second = { tag: "0001_b", sql: "create table appended.b ();" };

    await applyMigrations(database.url("owner"), [writeSet("appended", [first])]);
    expect(
      await applyMigrations(database.url("owner"), [writeSet("appended", [first, second])]),
    ).toEqual([{ moduleId: "appended", tag: "0001_b" }]);
  });

  it("refuses a migration edited after it was applied", async () => {
    const database = await createTestDatabase("migrate_edited");
    const set = copyOfFixture();
    await applyMigrations(database.url("owner"), [set]);

    const file = join(set.dir, "0001_items_rls.sql");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n-- a later edit\n`);

    await expect(applyMigrations(database.url("owner"), [set])).rejects.toThrow(
      /0001_items_rls changed after it was applied/,
    );
  });

  it("refuses when an applied migration left the journal", async () => {
    const database = await createTestDatabase("migrate_removed");
    const set = copyOfFixture();
    await applyMigrations(database.url("owner"), [set]);

    const journalFile = join(set.dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: unknown[] };
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
    );

    await expect(applyMigrations(database.url("owner"), [set])).rejects.toThrow(
      /0001_items_rls is not at position 1/,
    );
  });

  it("rolls a failing migration back and records nothing for it", async () => {
    const database = await createTestDatabase("migrate_failing");
    const set = writeSet("failing", [
      { tag: "0000_good", sql: "create schema failing; create table failing.kept ();" },
      { tag: "0001_bad", sql: "create table failing.lost (); select 1 / 0;" },
    ]);

    const error: unknown = await applyMigrations(database.url("owner"), [set]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as Error).message).toMatch(/0001_bad failed/);

    const superuser = await database.connect("superuser");
    try {
      const tables = await superuser.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = 'failing'",
      );
      expect(tables.rows).toEqual([{ name: "kept" }]);
      const applied = await superuser.query<{ tag: string }>(
        "select tag from mustawfi_migrations.applied",
      );
      expect(applied.rows).toEqual([{ tag: "0000_good" }]);
    } finally {
      await superuser.end();
    }
  });

  it("refuses to run as a superuser", async () => {
    const database = await createTestDatabase("migrate_superuser");
    await expect(
      applyMigrations(database.url("superuser"), [rlsFixtureMigrations]),
    ).rejects.toThrow(/never as a superuser/);
  });

  it("refuses a module listed twice", async () => {
    const database = await createTestDatabase("migrate_twice");
    await expect(
      applyMigrations(database.url("owner"), [rlsFixtureMigrations, rlsFixtureMigrations]),
    ).rejects.toThrow(/appears twice/);
  });
});

describe("readMigrations", () => {
  it("gives CRLF and LF checkouts the same checksums", async () => {
    const set = copyOfFixture();
    for (const tag of ["0000_items", "0001_items_rls"]) {
      const file = join(set.dir, `${tag}.sql`);
      writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    }
    const crlf = await readMigrations(set);
    const lf = await readMigrations(rlsFixtureMigrations);
    expect(crlf.map((m) => m.checksum)).toEqual(lf.map((m) => m.checksum));
  });
});
