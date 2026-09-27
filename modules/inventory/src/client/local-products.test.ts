import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newProductSchema, type ProductView } from "../shared/index.ts";
import {
  inventoryLocalMigrations,
  listLocalProducts,
  productPullApplier,
} from "./local-products.ts";

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, inventoryLocalMigrations);
});

afterEach(async () => {
  await db.close();
});

const product = (amount: string): ProductView => ({
  id: "0190a000-0000-7000-8000-000000000001",
  name: "كتاب",
  barcode: null,
  price: { amount, currency: "SYP" },
  createdAt: "2026-09-27T10:00:00.000Z",
});

/** Applies a pulled change as the sync engine does: in a local transaction. */
async function pull(row: ProductView): Promise<void> {
  await db.transaction(async (tx) => {
    await productPullApplier.apply(tx, { entity: "inventory.product", id: row.id, row });
  });
}

/**
 * A device keeps a price as a 64-bit integer scaled by 10^6 (ADR-0018): every price the server
 * accepts must fit, or the page carrying it fails on every device, and so does each pull after
 * it (QA slice 23: an ISBN scanned into the price field stopped every device's pull).
 */
describe("prices on the device", () => {
  it("hold the highest price the server accepts, exactly", async () => {
    const highest = product("999999999999.999999");
    expect(newProductSchema.safeParse({ name: "كتاب", price: highest.price }).success).toBe(true);
    await pull(highest);
    expect(await listLocalProducts(db)).toEqual([highest]);
  });

  it("are never beyond what a device holds: the server refuses them", () => {
    for (const amount of ["1000000000000", "9780201379624", "99999999999999.999999"]) {
      expect(
        newProductSchema.safeParse({ name: "كتاب", price: product(amount).price }).success,
      ).toBe(false);
    }
  });
});
