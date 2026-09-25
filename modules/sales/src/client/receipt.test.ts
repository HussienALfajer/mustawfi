import { accessLocalMigrations, type LocalDevice } from "@mustawfi/core-access/client";
import { syncLocalMigrations } from "@mustawfi/core-sync/client";
import { inventoryLocalMigrations, productPullApplier } from "@mustawfi/inventory/client";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKELETON_DOCUMENT_DEFAULTS } from "../shared/index.ts";
import { addToCart, completeCashSale, salesLocalMigrations } from "./local-sales.ts";
import { salesMessages } from "./messages.ts";
import {
  CASH_RECEIPT_TEMPLATE,
  type ReceiptFormat,
  readReceiptInvoice,
  receiptDocument,
} from "./receipt.ts";

const clock = manualClock(new Date("2026-09-25T21:30:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });

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

const format: ReceiptFormat = {
  label: (key) => `«${key}»`,
  currencyLabel: (code) => (code === "SYP" ? "ل.س" : code),
  digits: "latn",
  deviceName: device.name,
};

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [
    ...accessLocalMigrations,
    ...syncLocalMigrations,
    ...inventoryLocalMigrations,
    ...salesLocalMigrations,
  ]);
});

afterEach(async () => {
  await db.close();
});

async function product(name: string, price: string) {
  const id = newId();
  await db.transaction((tx) =>
    productPullApplier.apply(tx, {
      entity: "inventory.product",
      id,
      row: {
        id,
        name,
        barcode: null,
        price: { amount: price, currency: "SYP" },
        createdAt: clock.now().toISOString(),
      },
    }),
  );
  return id;
}

describe("receipt", () => {
  it("is the template version every skeleton invoice records", () => {
    expect(CASH_RECEIPT_TEMPLATE.version).toBe(SKELETON_DOCUMENT_DEFAULTS.templateVersion);
  });

  it("shows a recorded sale's lines in order, with exact amounts and the store's time", async () => {
    const charger = await product("شاحن سريع", "12500.5");
    const cover = await product("غطاء <شفاف>", "3000");
    await addToCart(db, charger);
    await addToCart(db, cover);
    await addToCart(db, charger);
    const sale = await completeCashSale(db, { device, userId: newId(), clock, newId });

    const invoice = await readReceiptInvoice(db, sale.invoiceId);
    expect(invoice).toBeDefined();
    const document = receiptDocument(invoice!, format);

    expect(document.templateVersion).toBe("receipt.skeleton.1");
    expect(document.documentName).toBe("K7-INV-000001");
    expect(document.data).toEqual({
      labels: {
        title: "«title»",
        number: "«number»",
        date: "«date»",
        device: "«device»",
        item: "«item»",
        quantity: "«quantity»",
        price: "«price»",
        amount: "«amount»",
        total: "«total»",
        thanks: "«thanks»",
      },
      invoice: {
        number: "K7-INV-000001",
        // 21:30 UTC is 00:30 the next day in Damascus (UTC+3).
        soldAt: "2026-09-26 00:30",
        device: "الصندوق الرئيسي",
        total: "28,001.00",
        currency: "ل.س",
      },
      lines: [
        { name: "شاحن سريع", quantity: "2", unitPrice: "12,500.50", amount: "25,001.00" },
        { name: "غطاء <شفاف>", quantity: "1", unitPrice: "3,000.00", amount: "3,000.00" },
      ],
    });
  });

  it("uses Arabic-Indic digits when the user reads them", async () => {
    await addToCart(db, await product("شاحن", "5"));
    const sale = await completeCashSale(db, { device, userId: newId(), clock, newId });
    const document = receiptDocument((await readReceiptInvoice(db, sale.invoiceId))!, {
      ...format,
      digits: "arab",
    });
    expect(document.data).toMatchObject({ invoice: { soldAt: "٢٠٢٦-٠٩-٢٦ ٠٠:٣٠", total: "٥٫٠٠" } });
  });

  it("refuses an invoice recorded with a template this client does not have", async () => {
    await addToCart(db, await product("شاحن", "5"));
    const sale = await completeCashSale(db, { device, userId: newId(), clock, newId });
    const invoice = (await readReceiptInvoice(db, sale.invoiceId))!;
    expect(() =>
      receiptDocument({ ...invoice, templateVersion: "receipt.other.2" }, format),
    ).toThrow(/receipt.other.2/);
  });

  it("has an Arabic message for every label it shows", async () => {
    await addToCart(db, await product("شاحن", "5"));
    const sale = await completeCashSale(db, { device, userId: newId(), clock, newId });
    const asked: string[] = [];
    receiptDocument((await readReceiptInvoice(db, sale.invoiceId))!, {
      ...format,
      label: (key) => {
        asked.push(key);
        return key;
      },
    });
    expect(asked.sort()).toEqual(Object.keys(salesMessages.receipt).sort());
  });

  it("finds no receipt for an unknown invoice", async () => {
    expect(await readReceiptInvoice(db, newId())).toBeUndefined();
  });
});
