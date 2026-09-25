import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DepartmentView, StoreProfileView } from "../shared/index.ts";
import {
  listLocalDepartments,
  organizationLocalMigrations,
  organizationPullAppliers,
  readLocalStoreProfile,
} from "./local-organization.ts";

const shop: DepartmentView = {
  id: "01a0d794-1000-7141-9365-dd8a6e8774ee",
  name: "المتجر",
  isDefault: true,
  sortOrder: 0,
  archivedAt: null,
};
const repairs: DepartmentView = {
  id: "01a0d794-1000-7141-9365-dd8a6e877500",
  name: "الصيانة",
  isDefault: false,
  sortOrder: 1,
  archivedAt: null,
};
const profile: StoreProfileView = {
  id: "01a0d794-1000-7141-9365-dd8a6e877510",
  name: "متجر النور",
  address: "دمشق",
  phones: ["0944123456", "+963 11 222 3333"],
  taxNumber: "123456",
  commercialRegister: null,
  logo: { type: "image/png", sha256: "a".repeat(64), size: 1024 },
  updatedAt: "2026-09-25T08:00:00.000Z",
};

type Change = { entity: string; id: string; row: Record<string, unknown> | null };

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, organizationLocalMigrations);
});

afterEach(async () => {
  await db.close();
});

/** Applies a pulled page as the sync engine does: one local transaction. */
async function apply(changes: readonly Change[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const change of changes) {
      const applier = organizationPullAppliers.find((a) => a.entity === change.entity);
      if (applier === undefined) throw new Error(`no applier for ${change.entity}`);
      await applier.apply(tx, change);
    }
  });
}

const department = (row: DepartmentView): Change => ({
  entity: "organization.department",
  id: row.id,
  row,
});

describe("pulled departments", () => {
  it("are stored, updated in place, and listed in order; archived ones only on request", async () => {
    await apply([department(repairs), department(shop)]);
    expect(await listLocalDepartments(db)).toEqual([shop, repairs]);

    const archived = {
      ...repairs,
      name: "الصيانة القديمة",
      archivedAt: "2026-09-26T08:00:00.000Z",
    };
    await apply([department(archived)]);
    expect(await listLocalDepartments(db)).toEqual([shop]);
    expect(await listLocalDepartments(db, { includeArchived: true })).toEqual([shop, archived]);
  });

  it("are removed by a tombstone", async () => {
    await apply([department(shop), { entity: "organization.department", id: shop.id, row: null }]);
    expect(await listLocalDepartments(db, { includeArchived: true })).toEqual([]);
  });
});

describe("the pulled store profile", () => {
  it("is stored without the logo's bytes and replaced by the next change", async () => {
    expect(await readLocalStoreProfile(db)).toBeUndefined();
    const change = { entity: "organization.storeProfile", id: profile.id };
    await apply([{ ...change, row: profile }]);
    expect(await readLocalStoreProfile(db)).toEqual(profile);

    const edited = { ...profile, name: "متجر النور الجديد", phones: [], logo: null };
    await apply([{ ...change, row: edited }]);
    expect(await readLocalStoreProfile(db)).toEqual(edited);
  });

  it("refuses a malformed row, leaving the page unapplied", async () => {
    await expect(
      apply([
        department(shop),
        { entity: "organization.storeProfile", id: profile.id, row: { name: "بلا حقول" } },
      ]),
    ).rejects.toThrow();
    expect(await listLocalDepartments(db)).toEqual([]);
  });
});
