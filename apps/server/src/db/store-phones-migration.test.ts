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
 * The upgrade of `core-foundation` slice 21 on a database the previous release wrote: the
 * store's phones, typed as people write them, are brought to E.164 (a national number read as
 * Syrian), and every profile prints its logo by threshold until the owner picks otherwise.
 * Tested across two tenants, since row-level security is lifted for the owner meanwhile.
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

const SLICE_21 = ["0004_store_profile_phones_logo_print"];

describe("the slice 21 upgrade", () => {
  it("brings the store's phones to E.164 and sets the logo's print mode", async () => {
    const database = await createTestDatabase("store_phones_upgrade");
    await applyMigrations(database.url("owner"), releasedSets(SLICE_21));
    const tenants = await openTenantDatabase({ connectionString: database.url("app") });
    const superuser = await database.connect("superuser");
    // Tenant creation is today's code, which writes the new columns: they exist only while the
    // tenants are created, and are dropped before the upgrade adds them.
    await superuser.query(
      `alter table core_organization.store_profiles
         add column logo_print text default 'threshold',
         add column unreadable_phones text[] default '{}'`,
    );
    try {
      const typed = [
        ["+963 11 222 3333", "0944-123-456", "944 123 456"],
        ["00961 3 123 456", "0944123456 0933123456", "0--"],
        ["1234567"],
      ];
      const stores = [];
      for (const [index, phones] of typed.entries()) {
        const store = await createLicensedTenant(
          tenants,
          {
            name: `متجر ${String(index)}`,
            baseCurrency: "SYP",
            ownerName: "أحمد",
            ownerLogin: "ahmad",
            ownerPassword: "correct horse battery staple",
          },
          dependencies,
        );
        stores.push(store);
        // The previous release stored the numbers as typed.
        await superuser.query(
          "update core_organization.store_profiles set phones = $2 where tenant_id = $1",
          [store.tenantId, phones],
        );
      }
      await superuser.query(
        `alter table core_organization.store_profiles
           drop column logo_print, drop column unreadable_phones`,
      );

      await applyMigrations(database.url("owner"), migrationSets);

      const rows = await Promise.all(
        stores.map((store) =>
          superuser.query<{ phones: string[]; unreadable_phones: string[]; logo_print: string }>(
            `select phones, unreadable_phones, logo_print from core_organization.store_profiles
              where tenant_id = $1`,
            [store.tenantId],
          ),
        ),
      );
      expect(rows.map((result) => result.rows)).toEqual([
        [
          {
            phones: ["+963112223333", "+963944123456", "+963944123456"],
            unreadable_phones: [],
            logo_print: "threshold",
          },
        ],
        // Nothing typed is lost: two numbers in one field and a fragment keep their text,
        // for the profile screen to flag.
        [
          {
            phones: ["+9613123456"],
            unreadable_phones: ["0944123456 0933123456", "0--"],
            logo_print: "threshold",
          },
        ],
        // The E.164 shape, not a real number: kept, and the profile screen flags it.
        [{ phones: ["+9631234567"], unreadable_phones: [], logo_print: "threshold" }],
      ]);

      // Row-level security is forced again on the table the upgrade rewrote.
      const forced = await superuser.query<{ forced: boolean }>(
        `select relforcerowsecurity as forced from pg_class
          where oid = 'core_organization.store_profiles'::regclass`,
      );
      expect(forced.rows).toEqual([{ forced: true }]);

      // From now on only E.164 is stored, and only the two print modes.
      const [store] = stores;
      if (store === undefined) throw new Error("no store");
      await expect(
        superuser.query(
          "update core_organization.store_profiles set phones = '{0944123456}' where tenant_id = $1",
          [store.tenantId],
        ),
      ).rejects.toThrow(/store_profiles_phones_e164/);
      await expect(
        superuser.query(
          "update core_organization.store_profiles set logo_print = 'halftone' where tenant_id = $1",
          [store.tenantId],
        ),
      ).rejects.toThrow(/store_profiles_logo_print/);
    } finally {
      await superuser.end();
      await tenants.close();
    }
  });
});
