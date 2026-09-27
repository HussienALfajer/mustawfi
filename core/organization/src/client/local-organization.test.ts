import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DepartmentView, StoreProfileView } from "../shared/index.ts";
import {
  listLocalDepartments,
  localDefaultDepartment,
  organizationLocalMigrations,
  organizationPullAppliers,
  readLocalStoreLogo,
  readLocalStoreProfile,
  refreshLocalStoreLogo,
  storeLogoLocalMigrations,
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
  phones: ["+963944123456", "+963112223333"],
  unreadablePhones: [],
  taxNumber: "123456",
  commercialRegister: null,
  logo: { type: "image/png", sha256: "a".repeat(64), size: 1024 },
  logoPrint: "dither",
  updatedAt: "2026-09-25T08:00:00.000Z",
};

type Change = { entity: string; id: string; row: Record<string, unknown> | null };

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [...organizationLocalMigrations, ...storeLogoLocalMigrations]);
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
  it("give the store's default department once it has arrived", async () => {
    expect(await localDefaultDepartment(db)).toBeUndefined();
    await apply([department(repairs)]);
    expect(await localDefaultDepartment(db)).toBeUndefined();
    await apply([department(shop)]);
    expect(await localDefaultDepartment(db)).toEqual(shop);
  });

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

/**
 * The change log keeps each row in the shape the server wrote it in, and a device registered
 * later pulls it from the start: every shape a release wrote must still apply (QA slice 23).
 * A field added to a pulled entity is optional or has a default; add its new shape here.
 */
describe("pulled rows in the shapes earlier releases wrote", () => {
  it("apply departments as written since slice 2", async () => {
    await apply([department(shop)]);
    expect(await listLocalDepartments(db)).toEqual([shop]);
  });

  it("apply a store profile written before slice 21 (no print mode, no unreadable phones)", async () => {
    const beforeSlice21 = {
      id: profile.id,
      name: "متجر التجربة",
      address: null,
      phones: ["+963 944 123 456"],
      taxNumber: null,
      commercialRegister: null,
      logo: { type: "image/png", sha256: "b".repeat(64), size: 227_686 },
      updatedAt: "2026-09-27T00:43:49.080Z",
    };
    await apply([{ entity: "organization.storeProfile", id: profile.id, row: beforeSlice21 }]);
    expect(await readLocalStoreProfile(db)).toEqual({
      ...beforeSlice21,
      unreadablePhones: [],
      logoPrint: "threshold",
    });
    // The next change, in today's shape, replaces it.
    await apply([{ entity: "organization.storeProfile", id: profile.id, row: profile }]);
    expect(await readLocalStoreProfile(db)).toEqual(profile);
  });
});

describe("the store's logo on the device", () => {
  const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const OTHER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

  async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function pullProfile(logo: Uint8Array | null): Promise<void> {
    const row = {
      ...profile,
      logo:
        logo === null ? null : { type: "image/png", sha256: await sha256(logo), size: logo.length },
    };
    await apply([{ entity: "organization.storeProfile", id: profile.id, row }]);
  }

  it("is fetched once when the pulled profile names it, and kept while it does", async () => {
    let fetches = 0;
    const fetchLogo = () => {
      fetches += 1;
      return Promise.resolve(LOGO);
    };
    expect(await refreshLocalStoreLogo(db, fetchLogo)).toBe(false);
    expect(fetches).toBe(0);

    await pullProfile(LOGO);
    expect(await readLocalStoreLogo(db)).toBeUndefined();
    expect(await refreshLocalStoreLogo(db, fetchLogo)).toBe(true);
    expect(await readLocalStoreLogo(db)).toEqual({ type: "image/png", bytes: LOGO });
    expect(await refreshLocalStoreLogo(db, fetchLogo)).toBe(false);
    expect(fetches).toBe(1);
  });

  it("is not kept when its bytes do not hash to the profile's, nor shown for another profile", async () => {
    await pullProfile(LOGO);
    // The logo changed again on the server since the pull: the next round fetches it.
    expect(await refreshLocalStoreLogo(db, () => Promise.resolve(OTHER))).toBe(false);
    expect(await readLocalStoreLogo(db)).toBeUndefined();

    await refreshLocalStoreLogo(db, () => Promise.resolve(LOGO));
    await pullProfile(OTHER);
    // The profile names another logo: the stored one is no longer printed.
    expect(await readLocalStoreLogo(db)).toBeUndefined();
    await refreshLocalStoreLogo(db, () => Promise.resolve(OTHER));
    expect(await readLocalStoreLogo(db)).toEqual({ type: "image/png", bytes: OTHER });
  });

  it("is forgotten when the profile has none", async () => {
    await pullProfile(LOGO);
    await refreshLocalStoreLogo(db, () => Promise.resolve(LOGO));
    await pullProfile(null);
    const fetchLogo = () => Promise.reject(new Error("no logo to fetch"));
    expect(await refreshLocalStoreLogo(db, fetchLogo)).toBe(true);
    expect(await readLocalStoreLogo(db)).toBeUndefined();
    expect(await refreshLocalStoreLogo(db, fetchLogo)).toBe(false);
  });
});
