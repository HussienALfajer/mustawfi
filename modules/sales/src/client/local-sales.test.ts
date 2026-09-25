import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessLocalMigrations, type LocalDevice } from "@mustawfi/core-access/client";
import { syncLocalMigrations } from "@mustawfi/core-sync/client";
import { syncOperationSchema } from "@mustawfi/core-sync/shared";
import { inventoryLocalMigrations, productPullApplier } from "@mustawfi/inventory/client";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, LocalDbError, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INVOICE_POST_OPERATION,
  invoicePostPayloadV1Schema,
  SKELETON_DOCUMENT_DEFAULTS,
} from "../shared/index.ts";
import {
  addToCart,
  businessDate,
  completeCashSale,
  listLocalInvoices,
  readCart,
  removeFromCart,
  SaleRefused,
  salesLocalMigrations,
} from "./local-sales.ts";

const clock = manualClock(new Date("2026-09-25T21:30:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const directory = mkdtempSync(join(tmpdir(), "mustawfi-sales-"));

const device: LocalDevice = {
  deviceId: newId(),
  tenantId: newId(),
  prefix: "K7",
  name: "الصندوق الرئيسي",
  type: "mainPos",
  credential: "d1.fixture",
  baseCurrency: "SYP",
  registeredAt: clock.now().toISOString(),
};
const userId = newId();

const migrations = [
  ...accessLocalMigrations,
  ...syncLocalMigrations,
  ...inventoryLocalMigrations,
  ...salesLocalMigrations,
];

let db: LocalDb;
let path: string;

async function openMigrated(file: string): Promise<LocalDb> {
  const opened = openNodeLocalDb(file);
  await migrateLocalDb(opened, migrations);
  return opened;
}

async function product(name: string, price: string, currency = "SYP", barcode = null) {
  const id = newId();
  await db.transaction((tx) =>
    productPullApplier.apply(tx, {
      entity: "inventory.product",
      id,
      row: {
        id,
        name,
        barcode,
        price: { amount: price, currency },
        createdAt: clock.now().toISOString(),
      },
    }),
  );
  return id;
}

async function count(table: string): Promise<bigint> {
  const [row] = await db.query(`SELECT count(*) AS n FROM ${table}`);
  return row?.["n"] as bigint;
}

function sell() {
  return completeCashSale(db, { device, userId, clock, newId });
}

beforeEach(async () => {
  path = join(directory, `${newId()}.sqlite3`);
  db = await openMigrated(path);
});

afterEach(async () => {
  await db.close();
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("completeCashSale", () => {
  it("commits the invoice, its number, its outbox entry, and the emptied cart together", async () => {
    const charger = await product("شاحن", "12.5");
    const cable = await product("كبل", "0.335");
    await addToCart(db, charger);
    await addToCart(db, charger);
    await addToCart(db, cable);

    const sale = await sell();
    expect(sale.number).toBe("K7-INV-000001");
    expect(sale.total.amount.toString()).toBe("25.34");

    const invoices = await listLocalInvoices(db);
    expect(invoices).toEqual([
      expect.objectContaining({
        id: sale.invoiceId,
        number: "K7-INV-000001",
        syncState: "pending",
      }),
    ]);
    expect(await count("sales_invoice_lines")).toBe(2n);
    expect((await readCart(db, "SYP")).lines).toEqual([]);

    const [entry] = await db.query("SELECT * FROM sync_outbox");
    const operation = syncOperationSchema.parse({
      opId: entry?.["op_id"],
      deviceId: device.deviceId,
      deviceSeq: Number.parseInt(String(entry?.["device_seq"]), 10),
      type: entry?.["type"],
      payloadVersion: Number.parseInt(String(entry?.["payload_version"]), 10),
      payload: JSON.parse(String(entry?.["payload"])) as unknown,
      userId: entry?.["user_id"],
      shiftId: entry?.["shift_id"],
      createdAt: entry?.["created_at"],
    });
    expect(operation).toMatchObject({
      deviceSeq: 1,
      type: INVOICE_POST_OPERATION,
      payloadVersion: 1,
      userId,
      shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
      createdAt: "2026-09-25T21:30:00.000Z",
    });
    // The server's contract, and ADR-0018's arithmetic: 0.335 rounds half away from zero.
    expect(invoicePostPayloadV1Schema.parse(operation.payload)).toMatchObject({
      id: sale.invoiceId,
      number: "K7-INV-000001",
      // 21:30 UTC is already the 26th in Damascus: the device's day, not the server's.
      businessDate: "2026-09-26",
      currency: "SYP",
      exchangeRate: "1",
      total: "25.34",
      lines: [
        { productId: charger, quantity: "2", unitPrice: "12.5", amount: "25" },
        { productId: cable, quantity: "1", unitPrice: "0.335", amount: "0.34" },
      ],
    });

    await addToCart(db, cable);
    expect((await sell()).number).toBe("K7-INV-000002");
    expect(
      (await db.query("SELECT device_seq FROM sync_outbox ORDER BY device_seq")).map(
        (row) => row["device_seq"],
      ),
    ).toEqual([1n, 2n]);
  });

  it("records nothing, and gives the number back, when any part of the sale fails", async () => {
    const charger = await product("شاحن", "12.5");
    await addToCart(db, charger);
    await db.run(
      "CREATE TRIGGER outbox_down BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox down'); END",
    );
    const failure: unknown = await sell().catch((error: unknown) => error);
    // Drizzle wraps the adapter's error.
    expect((failure as Error).cause).toBeInstanceOf(LocalDbError);
    expect(String((failure as Error).cause)).toContain("outbox down");
    expect(await count("sales_invoices")).toBe(0n);
    expect(await count("sales_invoice_lines")).toBe(0n);
    expect(await count("sync_outbox")).toBe(0n);
    expect(await count("sync_counters")).toBe(0n);
    expect((await readCart(db, "SYP")).lines).toHaveLength(1);

    await db.run("DROP TRIGGER outbox_down");
    expect((await sell()).number).toBe("K7-INV-000001");
  });

  it("refuses an empty cart, and a product priced in another currency", async () => {
    await expect(sell()).rejects.toEqual(new SaleRefused("emptyCart"));
    const imported = await product("سماعة", "20", "USD");
    await addToCart(db, imported);
    const cart = await readCart(db, "SYP");
    expect(cart.ready).toBe(false);
    expect(cart.lines[0]?.sellable).toBe(false);
    await expect(sell()).rejects.toEqual(new SaleRefused("notSellable"));
    await removeFromCart(db, imported);
    expect((await readCart(db, "SYP")).lines).toEqual([]);
    expect(await count("sync_counters")).toBe(0n);
  });

  it("keeps the cart when the app closes mid-sale", async () => {
    const charger = await product("شاحن", "12.5");
    await addToCart(db, charger);
    await addToCart(db, charger);
    await db.close();
    db = await openMigrated(path);
    const cart = await readCart(db, "SYP");
    expect(cart.lines.map((line) => [line.name, line.quantity.toString()])).toEqual([
      ["شاحن", "2"],
    ]);
    expect(cart.total.amount.toString()).toBe("25");
  });

  it("never changes or removes a recorded invoice", async () => {
    await addToCart(db, await product("شاحن", "12.5"));
    await sell();
    await expect(db.run("UPDATE sales_invoices SET total_scaled = 1")).rejects.toThrow(
      /cannot change/,
    );
    await expect(db.run("DELETE FROM sales_invoice_lines")).rejects.toThrow(/cannot be deleted/);
    expect(await count("sales_invoice_lines")).toBe(1n);
  });
});

describe("businessDate", () => {
  it("is the day in the store's time zone", () => {
    expect(businessDate(new Date("2026-09-25T20:59:59.000Z"), "Asia/Damascus")).toBe("2026-09-25");
    expect(businessDate(new Date("2026-09-25T21:00:00.000Z"), "Asia/Damascus")).toBe("2026-09-26");
  });
});
