import { migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { describe, expect, it } from "vitest";
import { LOCAL_MIGRATIONS } from "./local-migrations.ts";

/**
 * The local migrations devices already applied, in order. A release may only add to the end of
 * `LOCAL_MIGRATIONS`: append each released id here once it ships.
 */
const RELEASED = [
  "core.access.0001_device",
  "core.sync.0001_outbox",
  "inventory.0001_products",
  "sales.0001_cart_and_invoices",
];

describe("local migrations", () => {
  it("keep every released migration at its position", () => {
    expect(LOCAL_MIGRATIONS.slice(0, RELEASED.length).map((m) => m.id)).toEqual(RELEASED);
  });

  it("upgrade a database migrated by the previous release", async () => {
    const db = openNodeLocalDb(":memory:");
    try {
      await migrateLocalDb(db, LOCAL_MIGRATIONS.slice(0, RELEASED.length));
      const { applied } = await migrateLocalDb(db, LOCAL_MIGRATIONS);
      expect(applied).toEqual(LOCAL_MIGRATIONS.slice(RELEASED.length).map((m) => m.id));
    } finally {
      await db.close();
    }
  });
});
