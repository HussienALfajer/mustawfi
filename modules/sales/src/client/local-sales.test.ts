import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessLocalMigrations, type LocalDevice } from "@mustawfi/core-access/client";
import {
  departmentPullApplier,
  organizationLocalMigrations,
} from "@mustawfi/core-organization/client";
import type { DepartmentView } from "@mustawfi/core-organization/shared";
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
import type { SupervisorOverride } from "@mustawfi/core-access/shared";
import {
  addToCart,
  businessDate,
  type CashSaleInput,
  completeCashSale,
  listLocalInvoices,
  readCart,
  removeFromCart,
  SaleRefused,
  saleDepartmentId,
  salesLocalMigrations,
  salesOverrideLocalMigrations,
  type Seller,
} from "./local-sales.ts";

const clock = manualClock(new Date("2026-09-25T21:30:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
/** The license check of a device whose license allows documents. */
const allowed = () => Promise.resolve(null);
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
/** A seller who may sell everywhere, as the store's cashiers of every department. */
const seller: Seller = { userId, departmentScope: "all", departments: [], can: () => true };
const shop: DepartmentView = {
  id: newId(),
  name: "المتجر",
  isDefault: true,
  sortOrder: 0,
  archivedAt: null,
};

const migrations = [
  ...accessLocalMigrations,
  ...syncLocalMigrations,
  ...inventoryLocalMigrations,
  ...salesLocalMigrations,
  ...organizationLocalMigrations,
  ...salesOverrideLocalMigrations,
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

async function pullDepartment(department: DepartmentView): Promise<void> {
  await db.transaction((tx) =>
    departmentPullApplier.apply(tx, {
      entity: "organization.department",
      id: department.id,
      row: { ...department },
    }),
  );
}

async function count(table: string): Promise<bigint> {
  const [row] = await db.query(`SELECT count(*) AS n FROM ${table}`);
  return row?.["n"] as bigint;
}

function sell(input: Partial<CashSaleInput> = {}) {
  return completeCashSale(db, { device, seller, clock, newId, license: allowed, ...input });
}

/** The payload of the outbox entry of `invoiceId`. */
async function payloadOf(invoiceId: string): Promise<Record<string, unknown>> {
  const [row] = await db.query(
    "SELECT o.payload FROM sync_outbox o JOIN sales_invoices i ON i.op_id = o.op_id WHERE i.id = ?",
    [invoiceId],
  );
  return JSON.parse(String(row?.["payload"])) as Record<string, unknown>;
}

async function departmentOf(invoiceId: string): Promise<unknown> {
  const [row] = await db.query("SELECT department_id FROM sales_invoices WHERE id = ?", [
    invoiceId,
  ]);
  return row?.["department_id"];
}

beforeEach(async () => {
  path = join(directory, `${newId()}.sqlite3`);
  db = await openMigrated(path);
  await pullDepartment(shop);
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
      // The store's default department (rule 32), and the receipt that prints the store's name.
      departmentId: shop.id,
      templateVersion: "receipt.cash.2",
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

  it("sells under the default department, never another active one", async () => {
    await pullDepartment({ ...shop, id: newId(), name: "الصيانة", isDefault: false, sortOrder: 1 });
    await addToCart(db, await product("شاحن", "12.5"));
    const sale = await sell();
    expect(await departmentOf(sale.invoiceId)).toBe(shop.id);
  });

  it("sells under the seller's one listed department, else the default one (rule 32)", async () => {
    const repairs = { ...shop, id: newId(), name: "الصيانة", isDefault: false, sortOrder: 1 };
    const accessories = {
      ...shop,
      id: newId(),
      name: "الإكسسوارات",
      isDefault: false,
      sortOrder: 2,
    };
    await pullDepartment(repairs);
    await pullDepartment(accessories);
    const one: Seller = { ...seller, departmentScope: "listed", departments: [repairs.id] };
    const two: Seller = { ...one, departments: [repairs.id, accessories.id] };
    const charger = await product("شاحن", "12.5");
    const sold: unknown[] = [];
    for (const who of [one, two, seller]) {
      await addToCart(db, charger);
      sold.push(await departmentOf((await sell({ seller: who })).invoiceId));
    }
    expect(sold).toEqual([repairs.id, shop.id, shop.id]);
    expect(saleDepartmentId({ ...one, departmentScope: "all" }, shop.id)).toBe(shop.id);
    expect(saleDepartmentId({ ...one, departments: [] }, shop.id)).toBe(shop.id);
  });

  it("asks a supervisor when the seller may not sell there, recording nothing", async () => {
    await addToCart(db, await product("شاحن", "12.5"));
    const asked: [string, string][] = [];
    const outside: Seller = {
      ...seller,
      can: (permission, departmentId) => {
        asked.push([permission, departmentId]);
        return false;
      },
    };
    const refusal: unknown = await sell({ seller: outside }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SaleRefused);
    expect(refusal).toMatchObject({
      reason: "overrideNeeded",
      request: { permission: "sales.invoice.create", departmentId: shop.id },
    });
    expect(asked).toEqual([["sales.invoice.create", shop.id]]);
    expect(await count("sales_invoices")).toBe(0n);
    expect(await count("sync_outbox")).toBe(0n);
    expect(await count("sync_counters")).toBe(0n);
    expect((await readCart(db, "SYP")).lines).toHaveLength(1);

    // An override for another department, or another action, approves nothing here.
    const override: SupervisorOverride = {
      id: newId(),
      approverId: newId(),
      permission: "sales.invoice.create",
      departmentId: shop.id,
      grantedAt: clock.now().toISOString(),
    };
    for (const other of [
      { ...override, departmentId: newId() },
      { ...override, permission: "sales.invoices.view" },
    ]) {
      await expect(sell({ seller: outside, overrides: [other] })).rejects.toMatchObject({
        reason: "overrideNeeded",
      });
    }
    expect(await count("sales_invoices")).toBe(0n);

    // With the supervisor's override, the sale goes through and the invoice carries it.
    const sale = await sell({ seller: outside, overrides: [override] });
    expect(sale.number).toBe("K7-INV-000001");
    expect(invoicePostPayloadV1Schema.parse(await payloadOf(sale.invoiceId)).overrides).toEqual([
      override,
    ]);
    const [row] = await db.query("SELECT overrides FROM sales_invoices WHERE id = ?", [
      sale.invoiceId,
    ]);
    expect(JSON.parse(String(row?.["overrides"]))).toEqual([override]);
  });

  it("carries no overrides on a sale that needed none, even when given one", async () => {
    await addToCart(db, await product("شاحن", "12.5"));
    const sale = await sell({
      overrides: [
        {
          id: newId(),
          approverId: newId(),
          permission: "sales.invoice.create",
          departmentId: shop.id,
          grantedAt: clock.now().toISOString(),
        },
      ],
    });
    expect(await payloadOf(sale.invoiceId)).not.toHaveProperty("overrides");
    const [row] = await db.query("SELECT overrides FROM sales_invoices WHERE id = ?", [
      sale.invoiceId,
    ]);
    expect(row?.["overrides"]).toBe("[]");
  });

  it("refuses a sale before the store's departments reach the device, recording nothing", async () => {
    const fresh = await openMigrated(join(directory, `${newId()}.sqlite3`));
    const previous = db;
    db = fresh;
    try {
      await addToCart(db, await product("شاحن", "12.5"));
      await expect(sell()).rejects.toEqual(new SaleRefused("noDepartment"));
      expect(await count("sales_invoices")).toBe(0n);
      expect(await count("sync_outbox")).toBe(0n);
      expect(await count("sync_counters")).toBe(0n);
      expect((await readCart(db, "SYP")).lines).toHaveLength(1);
    } finally {
      await fresh.close();
      db = previous;
    }
  });

  it("records nothing while the license lets the device create no document, and keeps the cart", async () => {
    await addToCart(db, await product("شاحن", "12.5"));
    const readOnly = () => Promise.resolve("readOnly" as const);
    await expect(sell({ license: readOnly })).rejects.toEqual(
      new SaleRefused("licenseRestricted", { restriction: "readOnly" }),
    );
    expect(await count("sales_invoices")).toBe(0n);
    expect(await count("sync_outbox")).toBe(0n);
    expect(await count("sync_counters")).toBe(0n);
    expect((await readCart(db, "SYP")).lines).toHaveLength(1);
    // Once it may again, the same cart sells as the device's first invoice.
    expect((await sell()).number).toBe("K7-INV-000001");
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
