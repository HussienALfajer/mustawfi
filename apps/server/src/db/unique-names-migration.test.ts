import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase } from "@mustawfi/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createLicensedTenant } from "../tenants/licensed-tenant.test-helpers.ts";
import { applyMigrations, type MigrationSet } from "./migrate.ts";
import { migrationSets } from "./migration-sets.ts";

/**
 * The upgrade of `core-foundation` slice 20 on a database the previous release wrote: names
 * that collide once they are compared trimmed, with collapsed spaces, and case-insensitively
 * are told apart before the unique indexes are built, and devices get the platform their type
 * implied. Tested across two tenants, since row-level security is lifted for the owner while
 * the rows are rewritten.
 */

const clock = manualClock(new Date("2026-09-27T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

const temporaryDirs: string[] = [];

afterAll(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The released sets: each module's migrations without the tags this slice added. */
function releasedSets(added: readonly string[]): MigrationSet[] {
  return migrationSets.map((set) => {
    const dir = mkdtempSync(join(tmpdir(), "mustawfi-released-"));
    temporaryDirs.push(dir);
    cpSync(set.dir, dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => !added.includes(entry.tag));
    writeFileSync(journalPath, JSON.stringify(journal));
    return { moduleId: set.moduleId, dir };
  });
}

const SLICE_20 = [
  "0008_department_names",
  "0015_role_names_device_platform",
  "0004_audit_by_entity",
];

describe("the slice 20 upgrade", () => {
  it("tells colliding names apart, keeping them for active rows, and gives devices a platform", async () => {
    const database = await createTestDatabase("unique_names_upgrade");
    await applyMigrations(database.url("owner"), releasedSets(SLICE_20));
    const tenants = await openTenantDatabase({ connectionString: database.url("app") });
    const superuser = await database.connect("superuser");
    try {
      const stores = [];
      for (const name of ["متجر أ", "متجر ب"]) {
        stores.push(
          await createLicensedTenant(
            tenants,
            {
              name,
              baseCurrency: "SYP",
              ownerName: "أحمد",
              ownerLogin: "ahmad",
              ownerPassword: "correct horse battery staple",
            },
            dependencies,
          ),
        );
      }
      for (const store of stores) {
        const row = (name: string, archived: boolean, minutes: number) =>
          superuser.query(
            `insert into core_tenancy.departments
               (id, tenant_id, branch_id, created_at, created_by, name, is_default, sort_order,
                archived_at, archived_by)
             values (gen_random_uuid(), $1, $2, $3, $4, $5, false, $6,
                     case when $7 then now() end, case when $7 then $4::uuid end)`,
            [
              store.tenantId,
              store.branchId,
              new Date(clock.now().getTime() + minutes * 60_000),
              store.ownerId,
              name,
              minutes,
              archived,
            ],
          );
        // The previous release kept names unique among active departments only, as typed.
        await row("الصيانة", false, 1);
        await row("الصيانة", true, 2);
        await row("Phones", true, 3);
        await row("PHONES", false, 4);
        await row("  قسم   جديد ", false, 5);
        // The suffix another row already has is skipped; a non-breaking space collapses too.
        await row("الصيانة (2)", false, 6);
        await row("Tools Box", false, 7);
        const role = (name: string, archived: boolean) =>
          superuser.query(
            `insert into core_access.roles
               (id, tenant_id, branch_id, created_at, created_by, name, template, is_owner,
                archived_at, archived_by)
             values (gen_random_uuid(), $1, $2, now(), $3, $4, null, false,
                     case when $5 then now() end, case when $5 then $3::uuid end)`,
            [store.tenantId, store.branchId, store.ownerId, name, archived],
          );
        await role("المالك", true);
        await role("مؤقت", true);
        await role(" مؤقت", false);
        await superuser.query(
          `with code as (
             insert into core_access.registration_codes
               (id, tenant_id, branch_id, created_at, created_by, code_hash, expires_at, used_at)
             values (gen_random_uuid(), $1, $2, now(), $3, repeat('1', 64), now(), now())
             returning id)
           insert into core_access.devices
             (id, tenant_id, branch_id, created_at, created_by, name, type, prefix,
              credential_hash, registration_code_id)
           select gen_random_uuid(), $1, $2, now(), $3, 'هاتف', 'companion', 'M3',
             $4, code.id from code`,
          [
            store.tenantId,
            store.branchId,
            store.ownerId,
            store.tenantId.replace(/-/g, "").repeat(2),
          ],
        );
      }

      await applyMigrations(database.url("owner"), migrationSets);

      for (const store of stores) {
        const departments = await superuser.query<{ name: string; active: boolean }>(
          `select name, archived_at is null as active from core_tenancy.departments
            where tenant_id = $1 order by sort_order`,
          [store.tenantId],
        );
        expect(departments.rows).toEqual([
          { name: "المتجر", active: true },
          { name: "الصيانة", active: true },
          { name: "الصيانة (3)", active: false },
          { name: "Phones (2)", active: false },
          { name: "PHONES", active: true },
          { name: "قسم جديد", active: true },
          { name: "الصيانة (2)", active: true },
          { name: "Tools Box", active: true },
        ]);
        const roles = await superuser.query<{ name: string; owner: boolean; active: boolean }>(
          `select name, is_owner as owner, archived_at is null as active from core_access.roles
            where tenant_id = $1 and name ~ '^(المالك|مؤقت)' order by is_owner desc, name`,
          [store.tenantId],
        );
        expect(roles.rows).toEqual([
          { name: "المالك", owner: true, active: true },
          { name: "المالك (2)", owner: false, active: false },
          { name: "مؤقت", owner: false, active: true },
          { name: "مؤقت (2)", owner: false, active: false },
        ]);
        const devices = await superuser.query<{ platform: string }>(
          "select platform from core_access.devices where tenant_id = $1",
          [store.tenantId],
        );
        expect(devices.rows).toEqual([{ platform: "browser" }]);
      }

      // Row-level security is forced again on every table the upgrade rewrote.
      const forced = await superuser.query<{ table: string; forced: boolean }>(
        `select relname as table, relforcerowsecurity as forced from pg_class
          where oid in ('core_tenancy.departments'::regclass, 'core_access.roles'::regclass,
                        'core_access.devices'::regclass)
          order by relname`,
      );
      expect(forced.rows).toEqual([
        { table: "departments", forced: true },
        { table: "devices", forced: true },
        { table: "roles", forced: true },
      ]);
    } finally {
      await superuser.end();
      await tenants.close();
    }
  });
});
